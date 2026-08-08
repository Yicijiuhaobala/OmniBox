# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_data_files

backend_dir = Path(SPECPATH)
rapid_datas, rapid_binaries, rapid_hiddenimports = collect_all('rapidocr_onnxruntime')

a = Analysis(
    [str(backend_dir / 'main.py')],
    pathex=[str(backend_dir)],
    binaries=rapid_binaries,
    datas=collect_data_files('tzdata') + rapid_datas,
    hiddenimports=[
        'pypdf', 'docx', 'openpyxl',
        'yaml', 'jsonschema', 'croniter', 'regex', 'PIL', 'resvg_py', 'defusedxml',
        'autopep8', 'jsbeautifier', 'cssbeautifier', 'cssbeautifier._main', 'bs4',
        'cv2', 'onnxruntime', *rapid_hiddenimports,
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
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
