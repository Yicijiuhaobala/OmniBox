import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft, ArrowRight, BookOpenText, Bot, Check, CheckCircle2, CircleAlert,
  Clock3, ExternalLink, GraduationCap, Lightbulb, LoaderCircle, RefreshCw,
  RotateCcw, ShieldAlert, Sparkles, Target, TrendingDown, Wifi,
} from 'lucide-react'
import { api } from './api'
import course from './fund-learning/fund-foundation-v1.json'

const lessons = course.modules.flatMap((module) => module.lessons.map((lesson) => ({ ...lesson, module })))
const sources = Object.fromEntries(course.sources.map((source) => [source.id, source]))
const newSubmissionKey = () => `fund_${globalThis.crypto?.randomUUID?.().replaceAll('-', '') || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`
const percentage = (value) => `${Math.round(Number(value || 0) * 100)}%`

function lessonProgressMap(progress) {
  return Object.fromEntries((progress?.lessons || []).map((item) => [item.lesson_ref, item]))
}

function FundLearningPage({ tool, goHome, configured, openSettings }) {
  const ToolIcon = tool.icon
  const [activeLessonId, setActiveLessonId] = useState(lessons[0].id)
  const [mode, setMode] = useState('official')
  const [content, setContent] = useState(null)
  const [contentState, setContentState] = useState('loading')
  const [progress, setProgress] = useState(null)
  const [progressState, setProgressState] = useState('loading')
  const [answers, setAnswers] = useState({})
  const [feedback, setFeedback] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const submissionKeyRef = useRef('')
  const lessonStartedAt = useRef(Date.now())

  const activeIndex = lessons.findIndex((lesson) => lesson.id === activeLessonId)
  const activeLesson = lessons[activeIndex]
  const activeModule = activeLesson.module
  const activeModuleLessons = lessons.filter((lesson) => lesson.module.id === activeModule.id)
  const activeModuleLessonIndex = activeModuleLessons.findIndex((lesson) => lesson.id === activeLesson.id)
  const progressByLesson = useMemo(() => lessonProgressMap(progress), [progress])
  const activeProgress = progressByLesson[activeLesson.id]
  const completedInModule = activeModuleLessons.filter((lesson) => progressByLesson[lesson.id]?.completed).length

  const loadProgress = async () => {
    setProgressState('loading')
    try {
      const response = await api.fundProgress()
      setProgress(response.data)
      setProgressState('ready')
    } catch (error) {
      setProgressState(error.message)
    }
  }

  const loadContent = async (refresh = false, requestedMode = mode) => {
    setContentState('loading')
    setContent(null)
    setFeedback(null)
    setAnswers({})
    setMessage('')
    try {
      const response = await api.fundLessonContent(activeLesson.id, { mode: requestedMode, refresh })
      setContent(response.data.content)
      setContentState('ready')
      setMessage(response.summary)
    } catch (error) {
      setContentState('error')
      setMessage(`${error.code ? `${error.code}：` : ''}${error.message}${error.retryInstruction ? `；${error.retryInstruction}` : ''}`)
    }
  }

  useEffect(() => { loadProgress() }, [])
  useEffect(() => { loadContent(false, mode) }, [activeLessonId, mode])

  const selectLesson = (lessonId) => {
    setActiveLessonId(lessonId)
    setAnswers({})
    setFeedback(null)
    setMessage('')
    submissionKeyRef.current = ''
    lessonStartedAt.current = Date.now()
  }

  const changeMode = (nextMode) => {
    if (nextMode === 'ai' && !configured) {
      setMessage('AI 导师需要先配置模型 API Key；在线入门讲解无需 Key。')
      return
    }
    setMode(nextMode)
    submissionKeyRef.current = ''
    lessonStartedAt.current = Date.now()
  }

  const selectAnswer = (questionId, option) => {
    setAnswers((current) => ({ ...current, [questionId]: option }))
    setFeedback(null)
    setMessage('')
    submissionKeyRef.current = ''
  }

  const submitQuiz = async () => {
    const questions = content?.quiz || []
    if (!content?.content_id || !questions.length) return
    if (Object.keys(answers).length !== questions.length) {
      setMessage('请完成全部题目后再提交。')
      return
    }
    if (!submissionKeyRef.current) submissionKeyRef.current = newSubmissionKey()
    setSubmitting(true)
    setMessage('')
    try {
      const response = await api.saveFundAttempt({
        submission_key: submissionKeyRef.current,
        lesson_ref: activeLesson.id,
        content_id: content.content_id,
        answers,
        duration_ms: Math.max(0, Date.now() - lessonStartedAt.current),
      })
      setFeedback(response.data.attempt.feedback)
      setProgress(response.data.progress)
      setMessage(response.summary)
      submissionKeyRef.current = ''
    } catch (error) {
      setMessage(`${error.code ? `${error.code}：` : ''}${error.message}${error.retryInstruction ? `；${error.retryInstruction}` : ''}`)
    } finally {
      setSubmitting(false)
    }
  }

  const resetQuiz = () => {
    setAnswers({})
    setFeedback(null)
    setMessage('')
    submissionKeyRef.current = ''
    lessonStartedAt.current = Date.now()
  }

  const goNext = () => {
    if (activeIndex < lessons.length - 1) selectLesson(lessons[activeIndex + 1].id)
  }

  const selectModule = (moduleId) => {
    const firstLesson = lessons.find((lesson) => lesson.module.id === moduleId)
    if (firstLesson) selectLesson(firstLesson.id)
  }

  return (
    <motion.div className="page-scroll tool-page fund-learning-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <button className="back-link" onClick={goHome}><ArrowLeft size={15} /> 返回工具箱</button>

      <div className="tool-heading-row fund-heading">
        <div className={`tool-icon large ${tool.color}`}><ToolIcon size={27} /></div>
        <div><div className="title-with-badge"><h1>{tool.title}</h1><span className="fund-scope-badge"><GraduationCap size={12} />{course.market_scope}</span></div><p>{course.subtitle}</p></div>
      </div>

      <div className="fund-risk-banner" role="note">
        <ShieldAlert size={19} />
        <div><strong>先学习，再判断</strong><span>{course.risk_notice} 历史表现不代表未来结果。</span></div>
      </div>

      <section className="fund-overview">
        <div className="fund-progress-ring" style={{ '--progress': `${progress?.completion_percent || 0}%` }}><strong>{progress?.completion_percent || 0}%</strong><span>课程进度</span></div>
        <div className="fund-overview-copy"><span>{activeModule.code} · 第 {course.modules.findIndex((item) => item.id === activeModule.id) + 1} 阶段</span><h2>{activeModule.title}</h2><p>{activeModule.description}</p></div>
        <div className="fund-overview-stats"><div><strong>{completedInModule}/{activeModuleLessons.length}</strong><span>本阶段完成</span></div><div><strong>{progress?.completed_lessons || 0}/{progress?.total_lessons || lessons.length}</strong><span>全部课程</span></div></div>
      </section>

      <nav className="fund-roadmap" aria-label="基金基础课程阶段">
        {course.modules.map((module, index) => {
          const moduleLessons = lessons.filter((lesson) => lesson.module.id === module.id)
          const completed = moduleLessons.filter((lesson) => progressByLesson[lesson.id]?.completed).length
          return <button key={module.id} className={module.id === activeModule.id ? 'active' : ''} onClick={() => selectModule(module.id)}><span>{module.code}</span><strong>{module.title}</strong><small>{completed}/{moduleLessons.length} 课</small><i>{index + 1}</i></button>
        })}
      </nav>

      <section className="fund-knowledge-overview">
        <div><span>本课能解决什么问题</span><h2>{activeLesson.title}</h2><p>先用大白话理解，再看它对选择基金有什么用；专业原文只放在折叠的依据区。</p></div>
        <div className="fund-concept-chips">{activeLesson.objectives.map((objective) => <span key={objective}>{objective}</span>)}</div>
      </section>

      <div className="fund-course-layout">
        <aside className="fund-lesson-nav">
          <header><BookOpenText size={16} /><span><strong>{activeModule.code} · {activeModule.title}</strong><small>{progressState === 'loading' ? '读取本地进度…' : progressState === 'ready' ? `${activeModuleLessons.length} 课 · 仅进度保存在本机` : progressState}</small></span></header>
          <div className="fund-module-lessons">{activeModuleLessons.map((lesson, index) => {
            const itemProgress = progressByLesson[lesson.id]
            return <button key={lesson.id} className={activeLessonId === lesson.id ? 'active' : ''} onClick={() => selectLesson(lesson.id)}><span className="fund-lesson-index">{itemProgress?.completed ? <Check size={14} /> : String(index + 1).padStart(2, '0')}</span><span><strong>{lesson.title}</strong><small><Clock3 size={11} />{lesson.duration_minutes} 分钟{itemProgress?.attempt_count ? ` · 最佳 ${percentage(itemProgress.best_score)}` : ''}</small></span></button>
          })}</div>
        </aside>

        <main className="fund-lesson-content">
          <header className="fund-lesson-title">
            <div><span>{activeModule.code} · 第 {activeModuleLessonIndex + 1} 课 · {activeLesson.duration_minutes} 分钟</span><h2>{activeLesson.title}</h2><p>{activeLesson.summary}</p></div>
            <span className={`fund-lesson-status ${activeProgress?.completed ? 'completed' : ''}`}>{activeProgress?.completed ? <><CheckCircle2 size={14} />已完成</> : '学习中'}</span>
          </header>

          <section className="fund-content-toolbar">
            <div className="fund-mode-switch"><button className={mode === 'official' ? 'active' : ''} onClick={() => changeMode('official')}><Wifi size={14} />在线入门讲解</button><button className={mode === 'ai' ? 'active' : ''} onClick={() => changeMode('ai')}><Sparkles size={14} />AI 导师与测验</button></div>
            <div className="fund-content-meta"><span><ShieldAlert size={12} />正文不写入本地数据库</span><button onClick={() => loadContent(true)} disabled={contentState === 'loading'}><RefreshCw size={13} className={contentState === 'loading' ? 'spin' : ''} />重新获取</button></div>
          </section>

          {contentState === 'loading' && <div className="fund-content-loading"><LoaderCircle className="spin" size={22} /><strong>{mode === 'ai' ? '正在把权威资料整理成零基础讲解…' : '正在从权威网站整理入门知识…'}</strong><span>首次加载取决于网络和模型响应速度。</span></div>}

          {contentState === 'error' && <div className="fund-content-error"><CircleAlert size={20} /><div><strong>本课在线内容暂时不可用</strong><p>{message}</p>{!configured && <button className="secondary-button" onClick={openSettings}><Bot size={14} />配置模型服务</button>}</div></div>}

          {contentState === 'ready' && content && <>
            <section className="fund-online-status"><div><span className={content.mode}><Wifi size={13} />{content.mode === 'ai' ? 'AI 基于权威资料讲解' : '联网整理 · 零基础表达'}</span><strong>{content.knowledge_points.length} 个入门问题已就绪</strong></div><small>临时内存缓存约 {content.cache_ttl_minutes} 分钟 · {new Date(content.generated_at).toLocaleString('zh-CN')}</small></section>

            <section className="fund-online-points">
              <header><span>BEGINNER FIRST</span><h3>先解决你真正会遇到的问题</h3><p>{content.mode === 'ai' ? 'AI 负责讲人话、说明实际用途并给出检查动作，每一点都必须引用权威资料。' : '默认只展示入门解释和实际操作，法规或专业原文折叠在“为什么可以这样说”里面。'}</p></header>
              <div>{content.knowledge_points.map((point, index) => { const source = sources[point.source_id]; return <article key={point.id}><span>{String(index + 1).padStart(2, '0')}</span><div><h4>{point.title}</h4><span className="fund-point-label">一句话先记住</span><p>{point.explanation}</p><div className="fund-point-utility"><div><Target size={15} /><span><strong>这对你有什么用</strong><p>{point.why_it_matters || '帮助你把这个概念用于购买前的实际判断。'}</p></span></div><div><ArrowRight size={15} /><span><strong>现在怎么做</strong><p>{point.action || '先核对基金产品资料概要中的对应信息，看不懂就先不买。'}</p></span></div></div><details><summary>为什么可以这样说（查看权威原文）</summary><blockquote>{point.source_excerpt}</blockquote></details>{source && <a href={source.url} target="_blank" rel="noreferrer">{source.publisher} · {source.title}<ExternalLink size={12} /></a>}</div></article> })}</div>
            </section>

            {content.example && <section className="fund-example-card"><Lightbulb size={20} /><div><span>AI 情景示例</span><h3>{content.example.title}</h3><p className="good"><CheckCircle2 size={15} />{content.example.good}</p><p className="bad"><TrendingDown size={15} />{content.example.bad}</p></div></section>}

            {!!content.misconceptions?.length && <section className="fund-misconceptions"><h3>常见误区</h3>{content.misconceptions.map((item) => <p key={item}><CircleAlert size={15} />{item}</p>)}</section>}

            {mode === 'official' && <section className="fund-ai-invite"><Sparkles size={20} /><div><strong>还没理解？让 AI 换一种说法</strong><p>AI 会继续使用本次取得的权威资料，结合生活化例子重新讲解，并生成两道理解题；生成内容不会落盘。</p></div><button className="secondary-button" onClick={() => configured ? changeMode('ai') : openSettings()}>{configured ? '让 AI 再讲一遍' : '先配置模型'}</button></section>}

            {!!content.quiz?.length && <section className="fund-quiz">
              <header><div><span>AI 生成 · 本地评分</span><h3>用两道题确认是否理解</h3></div>{activeProgress?.attempt_count > 0 && <small>已作答 {activeProgress.attempt_count} 次 · 最佳 {percentage(activeProgress.best_score)}</small>}</header>
              {content.quiz.map((question, questionIndex) => { const questionFeedback = feedback?.items?.find((item) => item.question_id === question.id); return <fieldset key={question.id}><legend><span>{questionIndex + 1}</span>{question.question}</legend><div className="fund-quiz-options">{Object.entries(question.options).map(([key, label]) => { const classes = [answers[question.id] === key ? 'selected' : '']; if (questionFeedback?.correct_answer === key) classes.push('correct'); if (questionFeedback && questionFeedback.selected === key && !questionFeedback.correct) classes.push('incorrect'); return <button type="button" key={key} className={classes.join(' ')} onClick={() => selectAnswer(question.id, key)} disabled={submitting}><span>{key.toUpperCase()}</span>{label}</button> })}</div>{questionFeedback && <div className={`fund-answer-explanation ${questionFeedback.correct ? 'correct' : ''}`}><strong>{questionFeedback.correct ? '回答正确' : `正确答案：${questionFeedback.correct_answer.toUpperCase()}`}</strong><p>{questionFeedback.explanation}</p></div>}</fieldset> })}
              {feedback && <div className={`fund-quiz-result ${feedback.score >= course.completion_threshold ? 'passed' : ''}`}><strong>{feedback.score >= course.completion_threshold ? '本课已完成' : '建议回看知识点后再试一次'}</strong><span>本次得分 {percentage(feedback.score)}，答对 {feedback.correct_count}/{feedback.question_count} 题。只保存答案编号、得分和概念掌握度。</span></div>}
              <div className="fund-quiz-actions"><button className="secondary-button" onClick={resetQuiz} disabled={submitting}><RotateCcw size={14} />重新作答</button><button className="primary-button" onClick={submitQuiz} disabled={submitting}>{submitting ? '评分并保存中…' : '提交测验'}</button>{feedback?.score >= course.completion_threshold && activeIndex < lessons.length - 1 && <button className="secondary-button" onClick={goNext}>下一课 <ArrowRight size={14} /></button>}</div>
            </section>}

            {!!content.warnings?.length && <div className="fund-source-warnings">{content.warnings.map((warning) => <p key={warning}><CircleAlert size={13} />{warning}</p>)}</div>}
            <section className="fund-sources"><h3>本次在线来源</h3><p>状态和获取时间来自当前加载，不会把网页正文保存到本机。</p><div>{content.sources.map((item) => { const source = sources[item.id] || item; return <a key={item.id} href={source.url} target="_blank" rel="noreferrer"><span><strong>{source.title}</strong><small>{item.status === 'unavailable' ? '本次获取失败' : `${source.publisher} · ${item.fetched_at ? new Date(item.fetched_at).toLocaleString('zh-CN') : '等待获取'}`}</small></span><ExternalLink size={14} /></a> })}</div></section>
          </>}

          {message && contentState !== 'error' && <div className={`fund-save-message ${feedback ? '' : 'neutral'}`}>{message}</div>}
        </main>
      </div>
    </motion.div>
  )
}

export default FundLearningPage
