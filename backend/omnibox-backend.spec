# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files

backend_dir = Path(SPECPATH)

a = Analysis(
    [str(backend_dir / 'main.py')],
    pathex=[str(backend_dir)],
    binaries=[],
    datas=collect_data_files('tzdata') + [
        (str(backend_dir.parent / 'docs' / 'database' / '0001_learning_user_initial.sql'), 'migrations'),
        (str(backend_dir.parent / 'src' / 'fund-learning' / 'fund-foundation-v1.json'), 'learning-content/fund'),
    ],
    hiddenimports=[
        'pypdf', 'docx', 'pptx', 'openpyxl',
        'yaml', 'jsonschema', 'croniter', 'regex', 'PIL', 'resvg_py', 'defusedxml',
        'autopep8', 'jsbeautifier', 'cssbeautifier', 'cssbeautifier._main', 'bs4',
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=['rapidocr_onnxruntime', 'cv2', 'onnxruntime', 'numpy', 'shapely', 'pyclipper'],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='omnibox-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
)
