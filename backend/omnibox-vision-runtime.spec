# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path
from PyInstaller.utils.hooks import collect_all

backend_dir = Path(SPECPATH)
rapid_datas, rapid_binaries, rapid_hiddenimports = collect_all('rapidocr_onnxruntime')

a = Analysis(
    [str(backend_dir / 'vision_worker.py')],
    pathex=[str(backend_dir)],
    binaries=rapid_binaries,
    datas=rapid_datas,
    hiddenimports=['cv2', 'onnxruntime', *rapid_hiddenimports],
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
    name='omnibox-vision-runtime',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
)
