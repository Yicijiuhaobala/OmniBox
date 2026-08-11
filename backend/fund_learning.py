from __future__ import annotations

import hashlib
import json
import re
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

try:
    from .config_store import get_secret, read_config
    from .learning import (
        PROFILE_ID,
        LearningStore,
        LearningStoreError,
        canonical_json,
        response_envelope,
        secret_paths,
        store,
        utc_now,
    )
except ImportError:
    from config_store import get_secret, read_config
    from learning import (
        PROFILE_ID,
        LearningStore,
        LearningStoreError,
        canonical_json,
        response_envelope,
        secret_paths,
        store,
        utc_now,
    )


COURSE_FILE = "fund-foundation-v1.json"
EVALUATOR_VERSION = "fund-online-rule-v1"
CACHE_TTL_SECONDS = 30 * 60
MAX_SOURCE_BYTES = 2 * 1024 * 1024
MAX_AI_SOURCE_CHARS = 16_000
ALLOWED_SOURCE_SUFFIXES = ("amac.org.cn", "csrc.gov.cn")
DEFAULT_AI = {"base_url": "https://api.openai.com/v1", "model": "gpt-4.1-mini"}

CONTENT_CACHE: dict[str, dict[str, Any]] = {}
CONTENT_BY_ID: dict[str, dict[str, Any]] = {}


def course_path() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS")) / "learning-content" / "fund" / COURSE_FILE
    return Path(__file__).resolve().parent.parent / "src" / "fund-learning" / COURSE_FILE


@lru_cache(maxsize=1)
def load_course() -> dict[str, Any]:
    path = course_path()
    try:
        course = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise LearningStoreError(
            "FUND_COURSE_UNAVAILABLE",
            "基金课程目录不可用",
            status_code=503,
            retryable=False,
            root_cause_hint=str(path),
            retry_instruction="重新构建或安装包含基金课程目录的 OmniBox。",
            stop_condition="课程目录恢复前不要提交测验。",
        ) from exc
    if course.get("version") != "1.0.0" or not course.get("modules"):
        raise LearningStoreError("FUND_COURSE_INVALID", "基金课程目录版本或结构不受支持", status_code=503, retryable=False)
    return course


def lesson_index() -> dict[str, dict[str, Any]]:
    return {lesson["id"]: lesson for module in load_course()["modules"] for lesson in module["lessons"]}


def source_index() -> dict[str, dict[str, Any]]:
    return {source["id"]: source for source in load_course()["sources"]}


class FundContentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["official", "ai"] = "official"
    refresh: bool = False


class FundAttemptCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    submission_key: str = Field(min_length=8, max_length=100, pattern=r"^[A-Za-z0-9._-]+$")
    lesson_ref: str = Field(min_length=12, max_length=160, pattern=r"^lesson\.fund\.[a-z0-9_.]+$")
    content_id: str = Field(min_length=16, max_length=100, pattern=r"^fund_content_[a-f0-9]{32}$")
    answers: dict[str, str]
    duration_ms: int = Field(default=0, ge=0, le=7_200_000)


def result_name(score: float) -> str:
    if score >= 0.999999:
        return "correct"
    if score >= 0.5:
        return "partial"
    return "incorrect"


def mastery_state(score: float) -> str:
    if score >= 0.85:
        return "mastered"
    if score >= 0.6:
        return "reviewing"
    return "learning"


def next_review_at(score: float) -> str:
    days = 21 if score >= 0.85 else 7 if score >= 0.6 else 1
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def allowed_source_url(url: str) -> bool:
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and any(hostname == suffix or hostname.endswith(f".{suffix}") for suffix in ALLOWED_SOURCE_SUFFIXES)


def normalized_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def extract_readable_lines(html: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    for node in soup(["script", "style", "noscript", "svg", "nav", "footer"]):
        node.decompose()
    raw_lines = [normalized_text(line) for line in soup.get_text("\n").splitlines()]
    lines: list[str] = []
    seen: set[str] = set()
    for raw in raw_lines:
        if len(raw) < 12:
            continue
        pieces = re.split(r"(?<=[。！？；])", raw)
        for piece in pieces:
            text = normalized_text(piece)[:650]
            if len(text) < 12 or text in seen:
                continue
            if any(noise in text for noise in ("当前位置", "关闭窗口", "网站地图", "版权所有", "打印本页")):
                continue
            if text.endswith("_中国证券监督管理委员会"):
                continue
            seen.add(text)
            lines.append(text)
    return lines


async def fetch_source(source: dict[str, Any]) -> dict[str, Any]:
    url = source["url"]
    if not allowed_source_url(url):
        raise LearningStoreError("FUND_SOURCE_BLOCKED", "基金课程来源不在允许的权威域名中", retryable=False)
    headers = {"User-Agent": "OmniBox/0.1.0 FundLearning (+local educational client)", "Accept": "text/html,application/xhtml+xml"}
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers=headers) as client:
            response = await client.get(url)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise LearningStoreError(
            "FUND_SOURCE_FETCH_FAILED",
            f"无法读取权威来源：{source['title']}",
            status_code=502,
            root_cause_hint=str(exc),
            retry_instruction="检查网络后刷新；也可以打开来源原文确认。",
        ) from exc
    if not allowed_source_url(str(response.url)):
        raise LearningStoreError("FUND_SOURCE_REDIRECT_BLOCKED", "权威来源跳转到了未允许的域名", retryable=False)
    body = response.content[: MAX_SOURCE_BYTES + 1]
    if len(body) > MAX_SOURCE_BYTES:
        raise LearningStoreError("FUND_SOURCE_TOO_LARGE", "权威来源页面超过 2 MB，已停止读取")
    content_type = response.headers.get("content-type", "")
    if "html" not in content_type and "text" not in content_type:
        raise LearningStoreError("FUND_SOURCE_TYPE_UNSUPPORTED", "权威来源不是可读取的网页文本")
    response.encoding = response.encoding or "utf-8"
    lines = extract_readable_lines(response.text)
    normalized_title = normalized_text(source["title"])
    lines = [line for line in lines if line != normalized_title and not line.startswith(f"{normalized_title}_")]
    if not lines:
        raise LearningStoreError("FUND_SOURCE_EMPTY", "权威来源没有提取到可读正文")
    return {**source, "resolved_url": str(response.url), "fetched_at": utc_now(), "lines": lines}


def line_score(text: str, keywords: list[str]) -> tuple[int, int]:
    generic_keywords = {"基金", "投资", "风险", "收益", "产品"}
    matched = [keyword for keyword in keywords if keyword.lower() in text.lower()]
    specific_hits = sum(1 for keyword in matched if keyword not in generic_keywords)
    generic_hits = len(matched) - specific_hits
    off_topic_penalty = 30 if any(term in text for term in ("私募基金", "独立基金销售机构", "治理结构", "行政许可", "报眼及报花广告", "销售管理办法第")) else 0
    length_bonus = 4 if 35 <= len(text) <= 180 else 2 if len(text) <= 260 else 0
    return specific_hits * 20 + generic_hits * 4 + length_bonus - off_topic_penalty, -abs(len(text) - 90)


def simplify_official_text(text: str) -> str:
    simplified = re.sub(r"^[●（(]?[一二三四五六七八九十0-9]+[、.）)]\s*", "", normalized_text(text))
    simplified = simplified.lstrip("：:，,。. ")
    for marker in ("公募基金分红是", "基金不同于银行储蓄", "基金的特点是将零散的资金", "把预防性储蓄"):
        marker_index = simplified.find(marker)
        if marker_index > 0:
            simplified = simplified[marker_index:]
            break
    return simplified[:180].rstrip("，；; ") + ("…" if len(simplified) > 180 else "")


def beginner_question(lesson: dict[str, Any], keyword: str, source_text: str) -> str:
    if keyword == "股票型基金" and all(name in source_text for name in ("股票型基金", "债券型基金", "混合型基金", "货币型基金")):
        return "最常见的基金主要分哪四类？"
    if keyword == "单位净值" and "分红" in source_text:
        return "基金分红后，净值为什么会下降？"
    if keyword in {"基金合同", "招募说明书"} and any(fee in source_text for fee in ("认购费率", "申购费率", "赎回费率")):
        return "基金会收哪些费用，应该去哪里查？"
    questions = {
        "零散的资金": "买基金后，我的钱到底去了哪里？",
        "集合投资": "基金为什么能把很多人的钱放在一起？",
        "交给专业机构": "买基金是不是把钱交给专业机构管理？",
        "不同于银行储蓄": "基金和银行存款有什么不同？",
        "损失本金": "买基金会不会亏掉本金？",
        "长期理财": "基金适合短期赚快钱吗？",
        "股票型基金": "股票基金主要把钱投到哪里？",
        "股票基金": "股票基金主要把钱投到哪里？",
        "债券型基金": "债券基金主要把钱投到哪里？",
        "混合型基金": "混合基金为什么既像股票基金又像债券基金？",
        "货币型基金": "货币基金主要把钱投到哪里？",
        "风险收益特征": "不同基金的风险为什么不一样？",
        "投资对象": "判断基金类型时最先看什么？",
        "基金资产净值": "基金净值到底代表什么？",
        "单位净值": "单位净值高，就代表基金更贵吗？",
        "基金分红": "基金分红是额外多赚了一笔钱吗？",
        "不是额外": "为什么分红后我的总资产不会凭空增加？",
        "损失": "基金为什么会出现亏损？",
        "过往业绩": "过去涨得好，未来还会继续涨吗？",
        "并不预示": "过去涨得好，未来还会继续涨吗？",
        "并不预示未来业绩": "为什么不能只看历史收益排名？",
        "基金合同": "买基金前要不要读基金合同？",
        "招募说明书": "招募说明书里应该重点看什么？",
        "基金产品资料概要": "哪份文件最适合我快速了解一只基金？",
        "投资范围": "怎样知道基金经理会拿钱去买什么？",
        "认购费": "第一次募集时买基金会收什么费用？",
        "申购费": "平时买入基金可能收什么费用？",
        "赎回费": "卖出基金为什么还可能收费？",
        "管理费": "基金持有期间会持续扣费吗？",
        "到账": "赎回后资金什么时候能到账？",
        "预防性储蓄": "应急备用的钱适合买基金吗？",
        "投资目的": "买基金前为什么要先写清资金用途？",
        "投资期限": "多久以后要用这笔钱，会影响选择吗？",
        "风险承受能力": "怎样判断自己能承受多大亏损？",
        "理财目标": "基金类型怎样和我的目标匹配？",
        "长期持有": "为什么持有时间也要纳入判断？",
        "基金名称": "只看基金名称，能判断它买了什么吗？",
        "基金代码": "基金代码为什么需要和份额类别一起核对？",
        "投资策略": "投资策略对我选择基金有什么用？",
        "投资方向": "怎样判断一只基金的实际投资方向？",
        "同类产品": "名字相似的基金，表现为什么可能不同？",
        "重要信息": "产品资料概要里哪些信息最重要？",
        "投资目标": "基金的投资目标是不是收益承诺？",
        "业绩比较基准": "业绩比较基准到底是哪把尺子？",
        "投资风格": "为什么选择基金前要先理解它的投资风格？",
        "衡量业绩": "基金业绩应该和什么比较？",
        "约束投资行为": "业绩比较基准怎样约束基金的定位？",
        "基金经理": "看基金经理时，哪些信息比短期排名更重要？",
        "管理能力": "怎样避免把短期好运误认为管理能力？",
        "职业操守": "基金经理的信息应该从哪里核对？",
        "基金公司": "基金公司对基金运作有什么影响？",
        "A类": "同一基金的 A 类和 C 类为什么收费不同？",
        "C类": "C 类份额一定更适合短期持有吗？",
        "销售服务费": "销售服务费会怎样影响持有成本？",
        "持有时间": "预计持有时间为什么会影响份额选择？",
        "基金份额净值": "基金份额净值表示什么？",
        "累计净值": "累计净值和单位净值有什么不同？",
        "收益率": "看到收益率时为什么必须先看统计区间？",
        "统计区间": "不同时间区间的收益能直接比较吗？",
        "年化": "年化收益为什么不是未来固定利率？",
        "短期高收益": "短期涨得最多的基金值得马上买吗？",
        "基金排名": "为什么不能只按基金排行榜购买？",
        "追涨杀跌": "追涨杀跌为什么容易让基金投资体验变差？",
        "最大回撤": "最大回撤是在回答什么问题？",
        "最大亏损": "历史最大亏损能等同于未来最坏情况吗？",
        "高点": "回撤为什么要从历史高点开始计算？",
        "低点": "同样收益的基金，持有过程为什么可能不同？",
        "波动": "基金波动会怎样影响真实持有体验？",
        "同类基金": "什么样的基金才适合放在一起比较？",
        "基金评价": "评价基金时为什么要同时看收益和风险？",
        "产品选择": "风险评估怎样帮助我缩小选择范围？",
        "适宜": "风险等级相同就一定适合我吗？",
        "货币市场基金": "货币基金和银行活期存款有什么不同？",
        "短期货币工具": "货币基金主要把钱投向哪里？",
        "流动性": "流动性好是否等于资金一定能实时到账？",
        "债券基金": "债券基金为什么也可能亏损？",
        "债券": "债券基金和直接购买国债是一回事吗？",
        "利率风险": "利率变化为什么会影响债券基金净值？",
        "信用风险": "债券基金会面对哪些信用风险？",
        "股票资产": "股票仓位怎样影响基金波动？",
        "投资比例": "为什么要看股票投资比例的上下限？",
        "指数基金": "选择指数基金时，第一步应该看什么？",
        "标的指数": "标的指数怎样决定指数基金装了什么？",
        "跟踪误差": "跟踪误差小意味着什么？",
        "跟踪偏离": "指数上涨时，基金为什么可能没有完全跟上？",
        "成分股": "指数成分股会怎样影响基金风险？",
        "行业主题": "行业主题指数为什么可能比宽基指数波动更大？",
        "ETF": "ETF 和普通场外基金最直观的区别是什么？",
        "二级市场价格": "ETF 的成交价为什么可能不等于基金净值？",
        "折价": "ETF 折价代表什么？",
        "溢价": "买入溢价较高的 ETF 有什么风险？",
        "市场供求": "市场供求为什么会影响 ETF 成交价格？",
        "交易规则": "交易 ETF 前要额外检查哪些规则？",
        "资金安排": "基金赎回时间为什么要纳入资金安排？",
        "基金分类": "为什么应该先选基金类型，再找具体产品？",
        "最大回撤": "候选基金为什么要比较最大回撤？",
        "开放期": "定期开放基金什么时候才能赎回？",
        "封闭期": "封闭期内为什么可能无法赎回？",
        "赎回到账": "提交赎回后，资金为什么不会立即到账？",
        "申赎规则": "买入前为什么必须看申购赎回规则？",
        "频繁交易": "频繁买卖基金会带来哪些额外成本？",
        "申赎成本": "申赎成本会怎样侵蚀投资结果？",
        "风险等级": "基金风险等级怎样和我的承受能力匹配？",
        "风险评估": "风险评估结果应该怎样用于选择基金？",
        "主题基金": "主题基金为什么可能比名字看起来更集中？",
        "申购费率": "页面显示的申购费率就是全部成本吗？",
        "历史业绩": "历史业绩能告诉我什么，又不能保证什么？",
        "净值": "基金净值下跌时，本金会发生什么变化？",
        "基金净值": "基金净值和 ETF 的实时成交价有什么不同？",
    }
    return questions.get(keyword, f"学习“{keyword}”能帮我做出什么判断？")


def keyword_topic(keyword: str) -> str:
    if keyword in {"过往业绩", "并不预示", "并不预示未来业绩"}:
        return "historical_performance"
    return keyword


def beginner_guidance(lesson: dict[str, Any], keyword: str) -> tuple[str, str]:
    lesson_kind = lesson["id"].rsplit(".", 1)[-1]
    guidance = {
        "what_is_fund": (
            "先知道钱实际投向哪里，才能明白基金为什么会涨跌，也不会把它误当成保本储蓄。",
            "看到一只基金时，先打开产品资料概要，找“投资范围”和“风险提示”；这两项看不懂就先不买。",
        ),
        "fund_types": (
            "基金类型决定它主要投资什么，也大致决定你可能面对多大的波动和亏损。",
            "不要只看名称和收益排行，先看投资范围里股票、债券和现金类资产各占多少。",
        ),
        "nav_and_return": (
            "理解净值和收益来源，能避免把“净值低”误认为便宜，也能识别用历史收益诱导购买的说法。",
            "比较基金时同时看统计区间、风险提示和净值波动，不把某一年的高收益当成以后还能复制。",
        ),
        "before_buying": (
            "这些信息决定基金买了什么、可能亏多少、持有要花多少钱，以及需要用钱时能否及时赎回。",
            "购买前依次确认：投资范围、风险等级、申购赎回费、管理费、赎回到账时间；缺一项就继续查。",
        ),
        "suitable_for_me": (
            "同一只基金对别人合适，不代表对你也合适；关键是这笔钱何时要用以及你能承受多少亏损。",
            "先写下这笔钱的用途、最早使用日期和可接受的最大亏损；应急钱、借来的钱不要拿去承担高波动。",
        ),
    }
    base = (
        lesson.get("learner_value") or guidance.get(lesson_kind, ("", ""))[0]
        or "这能帮助你把专业信息转化成购买前可以检查的问题。",
        lesson.get("check_action") or guidance.get(lesson_kind, ("", ""))[1]
        or "先核对产品资料概要和风险提示，不理解的内容先记录、查清，再决定是否继续研究。",
    )
    if keyword in {"股票型基金", "债券型基金", "混合型基金", "货币型基金", "投资对象", "风险收益特征"}:
        return (
            "基金主要投资什么，通常比产品名称更能说明它可能有多大波动。",
            "在产品资料概要里找到“投资范围”，看看股票、债券和现金类资产分别能占多少。",
        )
    if keyword in {"不同于银行储蓄", "损失本金"}:
        return (
            "基金不承诺保本，净值下跌时你的本金也会减少；这和银行存款是根本区别。",
            "购买前先确认风险等级，并写下自己最多能接受亏损多少钱；无法接受本金减少就不要购买。",
        )
    if keyword == "长期理财":
        return (
            "基金净值会波动，用短期要花的钱购买，可能在急用钱时被迫亏损卖出。",
            "先确定这笔钱至少多久不用；应急钱、房租和近期必要支出不要用来承担基金波动。",
        )
    if keyword in {"认购费", "申购费", "赎回费", "管理费", "基金合同", "招募说明书"}:
        return (
            "费用会直接减少你最终拿到的收益，而且买入、持有、卖出可能分别收费。",
            "在招募说明书里记下申购费、赎回费、管理费、托管费和销售服务费，并确认对应持有期限。",
        )
    if keyword in {"基金资产净值", "单位净值", "基金分红", "不是额外"}:
        return (
            "看懂净值和分红，能避免把净值低误认为便宜，也不会把分红误认为凭空多赚的钱。",
            "比较分红前后的“份额 × 单位净值 + 已到账现金”，不要只看分红金额或净值高低。",
        )
    if keyword in {"过往业绩", "并不预示"}:
        return (
            "历史收益只能说明过去发生过什么，不能保证你买入之后还能重复。",
            "看到收益排行时，同时查看统计区间、最大回撤和风险等级，不根据一段历史排名直接购买。",
        )
    if keyword in {"预防性储蓄", "投资目的", "投资期限", "风险承受能力", "理财目标", "长期持有"}:
        return guidance["suitable_for_me"]
    return base


def select_knowledge_points(lesson: dict[str, Any], fetched_sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    candidates: list[tuple[tuple[int, int], dict[str, Any], str]] = []
    for source in fetched_sources:
        for line in source["lines"]:
            score = line_score(line, lesson["keywords"])
            if score[0] >= 12:
                candidates.append((score, source, line))
    candidates.sort(key=lambda item: item[0], reverse=True)

    points: list[dict[str, Any]] = []
    fingerprints: set[str] = set()
    source_counts: dict[str, int] = {}
    keyword_counts: dict[str, int] = {}
    for _, source, line in candidates:
        if source_counts.get(source["id"], 0) >= 2:
            continue
        fingerprint = re.sub(r"[^\w\u4e00-\u9fff]", "", line)[:48]
        if not fingerprint or any(fingerprint in existing or existing in fingerprint for existing in fingerprints):
            continue
        matched = next((keyword for keyword in lesson["keywords"] if keyword.lower() in line.lower()), "权威原文")
        topic = keyword_topic(matched)
        if matched != "权威原文" and keyword_counts.get(topic, 0) >= 1:
            continue
        fingerprints.add(fingerprint)
        source_counts[source["id"]] = source_counts.get(source["id"], 0) + 1
        keyword_counts[topic] = keyword_counts.get(topic, 0) + 1
        why_it_matters, action = beginner_guidance(lesson, matched)
        points.append({
            "id": f"source_point_{len(points) + 1}",
            "title": beginner_question(lesson, matched, line),
            "explanation": simplify_official_text(line),
            "why_it_matters": why_it_matters,
            "action": action,
            "source_id": source["id"],
            "source_excerpt": line,
            "kind": "official_beginner_explanation",
        })
        if len(points) == 4:
            break
    return points


def cache_key(lesson_ref: str, mode: str) -> str:
    return f"{lesson_ref}:{mode}"


def store_ephemeral_content(content: dict[str, Any]) -> dict[str, Any]:
    content["expires_monotonic"] = time.monotonic() + CACHE_TTL_SECONDS
    CONTENT_CACHE[cache_key(content["lesson_ref"], content["mode"])] = content
    CONTENT_BY_ID[content["content_id"]] = content
    if len(CONTENT_BY_ID) > 30:
        expired = sorted(CONTENT_BY_ID.values(), key=lambda item: item["expires_monotonic"])[:-20]
        for item in expired:
            CONTENT_BY_ID.pop(item["content_id"], None)
    return content


def get_cached(lesson_ref: str, mode: str) -> dict[str, Any] | None:
    content = CONTENT_CACHE.get(cache_key(lesson_ref, mode))
    if content and content["expires_monotonic"] > time.monotonic():
        return content
    if content:
        CONTENT_CACHE.pop(cache_key(lesson_ref, mode), None)
        CONTENT_BY_ID.pop(content["content_id"], None)
    return None


def public_content(content: dict[str, Any]) -> dict[str, Any]:
    public_quiz = [
        {key: value for key, value in question.items() if key not in {"answer", "explanation"}}
        for question in content.get("quiz", [])
    ]
    return {
        key: value
        for key, value in {**content, "quiz": public_quiz}.items()
        if key != "expires_monotonic"
    }


async def build_official_content(lesson: dict[str, Any]) -> dict[str, Any]:
    sources = source_index()
    fetched: list[dict[str, Any]] = []
    source_states: list[dict[str, Any]] = []
    warnings: list[str] = []
    for source_id in lesson["source_ids"]:
        source = sources[source_id]
        try:
            item = await fetch_source(source)
            fetched.append(item)
            source_states.append({key: item[key] for key in ("id", "title", "publisher", "url", "resolved_url", "fetched_at")})
        except LearningStoreError as exc:
            source_states.append({**source, "status": "unavailable"})
            warnings.append(exc.message)
    points = select_knowledge_points(lesson, fetched)
    if not points:
        raise LearningStoreError(
            "FUND_ONLINE_CONTENT_UNAVAILABLE",
            "暂时无法从权威来源提取本课知识点",
            status_code=502,
            retry_instruction="检查网络后刷新，或点击来源链接阅读原文。",
        )
    return store_ephemeral_content({
        "content_id": f"fund_content_{uuid.uuid4().hex}",
        "lesson_ref": lesson["id"],
        "mode": "official",
        "generated_at": utc_now(),
        "ephemeral": True,
        "cache_ttl_minutes": CACHE_TTL_SECONDS // 60,
        "knowledge_points": points,
        "example": None,
        "misconceptions": [],
        "quiz": [],
        "sources": source_states,
        "warnings": warnings,
    })


def parse_ai_json(text: str) -> dict[str, Any]:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.IGNORECASE)
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end <= start:
        raise LearningStoreError("FUND_AI_JSON_INVALID", "模型没有返回可解析的课程 JSON")
    try:
        return json.loads(cleaned[start:end + 1])
    except json.JSONDecodeError as exc:
        raise LearningStoreError("FUND_AI_JSON_INVALID", "模型返回的课程 JSON 格式不正确", root_cause_hint=str(exc)) from exc


def validate_ai_content(payload: dict[str, Any], lesson: dict[str, Any], official: dict[str, Any]) -> dict[str, Any]:
    source_points = {point["id"]: point for point in official["knowledge_points"]}
    raw_points = payload.get("knowledge_points")
    raw_quiz = payload.get("quiz")
    if not isinstance(raw_points, list) or not 3 <= len(raw_points) <= 5:
        raise LearningStoreError("FUND_AI_CONTENT_INVALID", "AI 讲解必须包含 3 至 5 个知识点")
    if not isinstance(raw_quiz, list) or len(raw_quiz) != 2:
        raise LearningStoreError("FUND_AI_CONTENT_INVALID", "AI 讲解必须包含 2 道测验")

    points: list[dict[str, Any]] = []
    for index, point in enumerate(raw_points):
        refs = point.get("source_point_ids")
        if not isinstance(refs, list) or not refs or any(ref not in source_points for ref in refs):
            raise LearningStoreError("FUND_AI_CITATION_INVALID", "AI 知识点缺少有效的权威原文引用")
        title = normalized_text(str(point.get("title", "")))[:60]
        explanation = normalized_text(str(point.get("explanation", "")))[:600]
        why_it_matters = normalized_text(str(point.get("why_it_matters", "")))[:400]
        action = normalized_text(str(point.get("action", "")))[:400]
        if len(title) < 2 or len(explanation) < 20 or len(why_it_matters) < 10 or len(action) < 10:
            raise LearningStoreError("FUND_AI_CONTENT_INVALID", "AI 知识点缺少入门解释、实际作用或操作建议")
        citation = source_points[refs[0]]
        points.append({
            "id": f"ai_point_{index + 1}",
            "title": title,
            "explanation": explanation,
            "why_it_matters": why_it_matters,
            "action": action,
            "source_id": citation["source_id"],
            "source_excerpt": citation["source_excerpt"],
            "source_point_ids": refs,
            "kind": "ai_explanation",
        })

    quiz: list[dict[str, Any]] = []
    allowed_concepts = set(lesson["concepts"])
    for index, question in enumerate(raw_quiz):
        options = question.get("options")
        answer = question.get("answer")
        concept_ref = question.get("concept_ref")
        if not isinstance(options, dict) or set(options) != {"a", "b", "c", "d"} or answer not in options:
            raise LearningStoreError("FUND_AI_QUIZ_INVALID", "AI 测验选项或答案格式不正确")
        if concept_ref not in allowed_concepts:
            raise LearningStoreError("FUND_AI_QUIZ_INVALID", "AI 测验引用了本课范围外的概念")
        quiz.append({
            "id": f"ai_quiz_{index + 1}_{hashlib.sha256(str(question.get('question')).encode()).hexdigest()[:8]}",
            "question": normalized_text(str(question.get("question", "")))[:300],
            "options": {key: normalized_text(str(value))[:180] for key, value in options.items()},
            "answer": answer,
            "explanation": normalized_text(str(question.get("explanation", "")))[:500],
            "concept_ref": concept_ref,
        })
    if any(len(question["question"]) < 8 or len(question["explanation"]) < 12 for question in quiz):
        raise LearningStoreError("FUND_AI_QUIZ_INVALID", "AI 测验题目或解析过短")

    example = payload.get("example") if isinstance(payload.get("example"), dict) else None
    if example:
        example = {key: normalized_text(str(example.get(key, "")))[:500] for key in ("title", "good", "bad")}
    misconceptions = [normalized_text(str(item))[:400] for item in payload.get("misconceptions", []) if normalized_text(str(item))][:4]
    return {"knowledge_points": points, "quiz": quiz, "example": example, "misconceptions": misconceptions}


async def build_ai_content(lesson: dict[str, Any], official: dict[str, Any]) -> dict[str, Any]:
    api_key = get_secret("api_key")
    if not api_key:
        raise LearningStoreError(
            "AI_KEY_REQUIRED",
            "AI 讲解需要先在设置中配置模型 API Key",
            status_code=409,
            retry_instruction="打开“服务与设置”配置模型，或切换到“在线入门讲解”模式。",
        )
    settings = {**DEFAULT_AI, **read_config()}
    base_url = str(settings.get("base_url", "")).rstrip("/")
    model = str(settings.get("model", "")).strip()
    if not base_url.startswith(("http://", "https://")) or not model:
        raise LearningStoreError("AI_SETTINGS_INVALID", "模型 API 地址或模型名称无效", status_code=409)

    source_payload = [
        {"id": point["id"], "source_id": point["source_id"], "excerpt": point["source_excerpt"]}
        for point in official["knowledge_points"]
    ]
    prompt = f"""请基于给定权威原文，为零基础学习者生成《{lesson['title']}》课程讲解。
只允许解释原文能够支持的内容；不要推荐具体基金，不要给出买卖指令或收益承诺。
知识点必须引用 source_point_ids；测验只能覆盖 concepts 中的概念。
每个知识点必须回答四件事：零基础学习者真正会问的问题、一段不超过 120 字且不堆术语的解释、它对实际选择基金有什么用、现在可以执行的检查动作。
返回严格 JSON，不要 Markdown：
{{"knowledge_points":[{{"title":"一个初学者问题","explanation":"大白话解释","why_it_matters":"对实际选择基金的作用","action":"现在可以执行的一步","source_point_ids":["source_point_1"]}}],"example":{{"title":"...","good":"有边界的示例","bad":"常见错误示例"}},"misconceptions":["..."],"quiz":[{{"question":"...","options":{{"a":"...","b":"...","c":"...","d":"..."}},"answer":"a","explanation":"...","concept_ref":"..."}}]}}
要求 knowledge_points 为 3-5 个，quiz 恰好 2 题且每题只有一个正确答案。禁止直接复制法规长句作为 explanation。

课程目标：{canonical_json(lesson['objectives'])}
允许概念：{canonical_json(lesson['concepts'])}
权威原文：{canonical_json(source_payload)[:MAX_AI_SOURCE_CHARS]}"""
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": "你是严谨的中国公募基金基础教育编辑。只能依据用户提供的权威原文，不构成投资建议。"},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
    }
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(f"{base_url}/chat/completions", headers={"Authorization": f"Bearer {api_key}"}, json=body)
            response.raise_for_status()
            text = response.json()["choices"][0]["message"]["content"]
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:500]
        raise LearningStoreError("FUND_AI_REQUEST_FAILED", f"模型服务返回错误（{exc.response.status_code}）", status_code=502, root_cause_hint=detail) from exc
    except (httpx.HTTPError, KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise LearningStoreError("FUND_AI_REQUEST_FAILED", "模型服务暂时不可用或响应格式不正确", status_code=502, root_cause_hint=str(exc)) from exc

    generated = validate_ai_content(parse_ai_json(text), lesson, official)
    return store_ephemeral_content({
        "content_id": f"fund_content_{uuid.uuid4().hex}",
        "lesson_ref": lesson["id"],
        "mode": "ai",
        "generated_at": utc_now(),
        "ephemeral": True,
        "cache_ttl_minutes": CACHE_TTL_SECONDS // 60,
        **generated,
        "sources": official["sources"],
        "warnings": official["warnings"],
    })


async def get_lesson_content(lesson_ref: str, mode: str, refresh: bool) -> dict[str, Any]:
    lesson = lesson_index().get(lesson_ref)
    if lesson is None:
        raise LearningStoreError("FUND_LESSON_NOT_FOUND", "找不到对应的基金课程", status_code=404, retryable=False)
    if not refresh:
        cached = get_cached(lesson_ref, mode)
        if cached:
            return public_content(cached)
    official = get_cached(lesson_ref, "official")
    if official is None or refresh:
        official = await build_official_content(lesson)
    content = official if mode == "official" else await build_ai_content(lesson, official)
    return public_content(content)


class FundLearningService:
    def __init__(self, learning_store: LearningStore) -> None:
        self.store = learning_store

    def progress(self) -> dict[str, Any]:
        course = load_course()
        lessons = [lesson for module in course["modules"] for lesson in module["lessons"]]
        with self.store._open() as connection:
            self.store._ensure_profile(connection)
            rows = connection.execute(
                """
                SELECT id, exercise_ref, result, score, submitted_at
                FROM attempts
                WHERE profile_id = ? AND exercise_ref LIKE 'lesson.fund.%'
                ORDER BY submitted_at DESC, id DESC
                """,
                (PROFILE_ID,),
            ).fetchall()
            mastery_rows = connection.execute(
                """
                SELECT concept_ref, state, mastery_score, next_review_at
                FROM concept_mastery
                WHERE profile_id = ? AND concept_ref LIKE 'concept.fund.%'
                ORDER BY concept_ref
                """,
                (PROFILE_ID,),
            ).fetchall()
        grouped: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            grouped.setdefault(row["exercise_ref"], []).append(dict(row))
        threshold = float(course.get("completion_threshold", 0.8))
        lesson_progress: list[dict[str, Any]] = []
        completed = 0
        for lesson in lessons:
            attempts = grouped.get(lesson["id"], [])
            best_score = max((float(item["score"] or 0) for item in attempts), default=0.0)
            is_completed = best_score >= threshold
            completed += int(is_completed)
            latest = attempts[0] if attempts else None
            lesson_progress.append({
                "lesson_ref": lesson["id"], "attempt_count": len(attempts), "best_score": best_score,
                "latest_score": float(latest["score"] or 0) if latest else None,
                "latest_result": latest["result"] if latest else None,
                "latest_submitted_at": latest["submitted_at"] if latest else None, "completed": is_completed,
            })
        total = len(lessons)
        return {
            "course_ref": course["id"], "course_version": course["version"], "completed_lessons": completed,
            "total_lessons": total, "completion_percent": round((completed / total * 100) if total else 0),
            "lessons": lesson_progress, "mastery": [dict(row) for row in mastery_rows],
        }

    def create_attempt(self, payload: FundAttemptCreate) -> tuple[dict[str, Any], bool]:
        course = load_course()
        lesson = lesson_index().get(payload.lesson_ref)
        if lesson is None:
            raise LearningStoreError("FUND_LESSON_NOT_FOUND", "找不到对应的基金课程", status_code=404, retryable=False)
        content = CONTENT_BY_ID.get(payload.content_id)
        if content is None or content.get("expires_monotonic", 0) <= time.monotonic():
            raise LearningStoreError(
                "FUND_CONTENT_EXPIRED", "本次在线课程内容已经过期", status_code=409,
                retry_instruction="重新加载本课 AI 讲解后再提交测验。",
            )
        if content["lesson_ref"] != payload.lesson_ref or content["mode"] != "ai":
            raise LearningStoreError("FUND_CONTENT_MISMATCH", "测验与当前课程内容不匹配", status_code=409)
        questions = content.get("quiz") or []
        expected_ids = {question["id"] for question in questions}
        received_ids = set(payload.answers)
        if not questions or received_ids != expected_ids:
            raise LearningStoreError("FUND_ANSWERS_INCOMPLETE", "请完成当前 AI 讲解生成的全部测验题目")
        if secret_paths(payload.model_dump()):
            raise LearningStoreError("SENSITIVE_FIELD_REJECTED", "测验答案中不能包含敏感字段")

        feedback_items: list[dict[str, Any]] = []
        persisted_feedback_items: list[dict[str, Any]] = []
        concept_scores: dict[str, list[float]] = {}
        correct_count = 0
        for question in questions:
            selected = payload.answers[question["id"]]
            if selected not in question["options"]:
                raise LearningStoreError("FUND_ANSWER_INVALID", f"题目 {question['id']} 的选项无效")
            is_correct = selected == question["answer"]
            correct_count += int(is_correct)
            concept_scores.setdefault(question["concept_ref"], []).append(1.0 if is_correct else 0.0)
            persisted = {
                "question_id": question["id"], "selected": selected, "correct": is_correct,
                "correct_answer": question["answer"], "concept_ref": question["concept_ref"],
            }
            persisted_feedback_items.append(persisted)
            feedback_items.append({**persisted, "explanation": question["explanation"]})

        score = correct_count / len(questions)
        result = result_name(score)
        answer_snapshot = canonical_json({
            "lesson_ref": payload.lesson_ref, "course_version": course["version"],
            "content_id": payload.content_id, "content_mode": "ai", "answers": payload.answers,
            "source_ids": [source["id"] for source in content["sources"] if source.get("id")],
        })
        persisted_feedback = {
            "score": score, "correct_count": correct_count, "question_count": len(questions),
            "items": persisted_feedback_items, "completion_threshold": course.get("completion_threshold", 0.8),
        }
        response_feedback = {**persisted_feedback, "items": feedback_items}
        feedback_json = canonical_json(persisted_feedback)
        now = utc_now()
        attempt_id = f"attempt_{uuid.uuid4().hex}"
        evidence_id = f"evidence_{uuid.uuid4().hex}"
        session_id = f"session_{uuid.uuid4().hex}"
        idempotent = False

        with self.store._open() as connection:
            self.store._ensure_profile(connection)
            existing = connection.execute(
                "SELECT id, answer_snapshot_json, result, score, feedback_json, submitted_at FROM attempts WHERE profile_id = ? AND submission_key = ?",
                (PROFILE_ID, payload.submission_key),
            ).fetchone()
            if existing:
                if existing["answer_snapshot_json"] != answer_snapshot:
                    raise LearningStoreError("IDEMPOTENCY_CONFLICT", "相同 submission_key 已用于不同的基金测验答案", status_code=409)
                attempt = {
                    "id": existing["id"], "lesson_ref": payload.lesson_ref, "result": existing["result"],
                    "score": float(existing["score"] or 0), "feedback": response_feedback,
                    "submitted_at": existing["submitted_at"],
                }
                idempotent = True
            else:
                connection.execute(
                    """
                    INSERT INTO learning_sessions(
                        id, profile_id, plan_item_id, domain, context_type, context_ref, context_json,
                        started_at, last_active_at, ended_at, active_seconds, end_reason, summary
                    ) VALUES (?, ?, NULL, 'fund', 'lesson_quiz', ?, ?, ?, ?, ?, ?, 'completed', ?)
                    """,
                    (session_id, PROFILE_ID, payload.lesson_ref, canonical_json({"course_ref": course["id"], "content_mode": "ai"}), now, now, now, payload.duration_ms // 1000, f"完成《{lesson['title']}》在线测验，得分 {round(score * 100)}%"),
                )
                connection.execute(
                    """
                    INSERT INTO attempts(
                        id, profile_id, session_id, plan_item_id, exercise_ref, exercise_version,
                        submission_key, answer_snapshot_json, result, evaluation_status, score,
                        hint_level, duration_ms, feedback_json, current_evaluation_version, submitted_at, evaluated_at
                    ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 'evaluated', ?, 0, ?, ?, 1, ?, ?)
                    """,
                    (attempt_id, PROFILE_ID, session_id, payload.lesson_ref, course["version"], payload.submission_key, answer_snapshot, result, score, payload.duration_ms, feedback_json, now, now),
                )
                connection.execute(
                    """
                    INSERT INTO attempt_evaluations(
                        id, attempt_id, version, evaluator, evaluator_name, evaluator_version,
                        status, result, score, feedback_json, error_json, started_at, completed_at, is_current
                    ) VALUES (?, ?, 1, 'rule', '基金在线课程本地评分器', ?, 'completed', ?, ?, ?, '{}', ?, ?, 1)
                    """,
                    (f"evaluation_{uuid.uuid4().hex}", attempt_id, EVALUATOR_VERSION, result, score, feedback_json, now, now),
                )
                evidence_payload = canonical_json({
                    "course_ref": course["id"], "lesson_ref": payload.lesson_ref, "score": score,
                    "correct_count": correct_count, "question_count": len(questions), "content_mode": "ai",
                    "source_ids": [source["id"] for source in content["sources"] if source.get("id")],
                })
                connection.execute(
                    """
                    INSERT INTO learning_evidence(
                        id, profile_id, source_type, source_id, evaluator, quality, validity, weight,
                        evidence_json, content_version, evaluation_version, occurred_at
                    ) VALUES (?, ?, 'attempt', ?, 'rule', ?, 'valid', 0.8, ?, ?, ?, ?)
                    """,
                    (evidence_id, PROFILE_ID, attempt_id, result, evidence_payload, course["version"], EVALUATOR_VERSION, now),
                )
                for concept_ref in lesson["concepts"]:
                    connection.execute(
                        "INSERT INTO evidence_concepts(evidence_id, concept_ref, role) VALUES (?, ?, ?)",
                        (evidence_id, concept_ref, "primary" if concept_ref in concept_scores else "supporting"),
                    )
                for concept_ref, values in concept_scores.items():
                    observed_score = sum(values) / len(values)
                    current = connection.execute(
                        "SELECT id, state, mastery_score FROM concept_mastery WHERE profile_id = ? AND concept_ref = ?",
                        (PROFILE_ID, concept_ref),
                    ).fetchone()
                    previous_state = current["state"] if current else "new"
                    previous_score = float(current["mastery_score"] or 0) if current else 0.0
                    updated_score = round(previous_score * 0.65 + observed_score * 0.35, 4)
                    updated_state = mastery_state(updated_score)
                    review_at = next_review_at(updated_score)
                    mastery_id = current["id"] if current else f"mastery_{uuid.uuid4().hex}"
                    if current:
                        connection.execute(
                            "UPDATE concept_mastery SET state = ?, mastery_score = ?, evidence_count = evidence_count + 1, last_practiced_at = ?, next_review_at = ?, updated_at = ? WHERE id = ?",
                            (updated_state, updated_score, now, review_at, now, mastery_id),
                        )
                    else:
                        connection.execute(
                            """
                            INSERT INTO concept_mastery(
                                id, profile_id, concept_ref, state, mastery_score, evidence_count,
                                last_practiced_at, next_review_at, algorithm_name, algorithm_version, algorithm_data_json
                            ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'fund_quiz_v1', '1', ?)
                            """,
                            (mastery_id, PROFILE_ID, concept_ref, updated_state, updated_score, now, review_at, canonical_json({"last_observed_score": observed_score})),
                        )
                    connection.execute(
                        """
                        INSERT INTO mastery_events(
                            id, mastery_id, evidence_id, previous_state, new_state,
                            previous_score, new_score, reason_json, algorithm_version
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '1')
                        """,
                        (f"mastery_event_{uuid.uuid4().hex}", mastery_id, evidence_id, previous_state, updated_state, previous_score, updated_score, canonical_json({"attempt_id": attempt_id, "observed_score": observed_score})),
                    )
                attempt = {
                    "id": attempt_id, "lesson_ref": payload.lesson_ref, "result": result,
                    "score": score, "feedback": response_feedback, "submitted_at": now,
                }
        return {"attempt": attempt, "progress": self.progress()}, idempotent


service = FundLearningService(store)
router = APIRouter(prefix="/api/learning/fund", tags=["fund-learning"])


def http_error(error: LearningStoreError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=error.detail())


@router.get("/progress")
def get_fund_progress() -> dict[str, Any]:
    try:
        return response_envelope("基金学习进度读取成功", service.progress())
    except LearningStoreError as exc:
        raise http_error(exc) from exc


@router.post("/lessons/{lesson_ref}/content")
async def load_fund_lesson_content(lesson_ref: str, payload: FundContentRequest) -> dict[str, Any]:
    try:
        content = await get_lesson_content(lesson_ref, payload.mode, payload.refresh)
        label = "AI 已基于权威资料生成零基础临时讲解" if payload.mode == "ai" else "已把权威网站内容整理为入门知识"
        return response_envelope(label, {"content": content}, next_actions=["核对每个知识点下方的来源原文。"])
    except LearningStoreError as exc:
        raise http_error(exc) from exc


@router.post("/attempts")
def create_fund_attempt(payload: FundAttemptCreate) -> dict[str, Any]:
    try:
        result, idempotent = service.create_attempt(payload)
        return response_envelope(
            "测验记录已存在" if idempotent else "测验结果与掌握度已保存到本机",
            {**result, "idempotent": idempotent},
            next_actions=["课程正文与 AI 讲解不会写入本地数据库。"],
        )
    except LearningStoreError as exc:
        raise http_error(exc) from exc
