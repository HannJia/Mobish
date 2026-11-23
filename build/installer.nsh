; 安装程序界面显示中文名。只改显示用的 PRODUCT_NAME；
; 程序文件名和安装目录仍用 mobish（由 PRODUCT_FILENAME 决定），卸载项注册表键由 APP_GUID 决定，也不变。
; “应用和功能”里的显示名由 package.json 的 nsis.uninstallDisplayName 设置。
; electron-builder 把本文件放在模板和提示语之前，所以窗口标题、底部版本栏和提示语都会使用这里的名字。
!undef PRODUCT_NAME
!define PRODUCT_NAME "墨笔生花"

; 用“浏览”选择位置后，自动在所选文件夹后面补上 mobish（NSIS 会把 InstallDir 的最后一级追加到所选路径）。
; 实际默认安装位置仍由 electron-builder 在 .onInit 中设置；手动输入不含 mobish 的路径时，模板在开始安装前也会补上。
InstallDir "$LOCALAPPDATA\Programs\mobish"
!define MUI_DIRECTORYPAGE_TEXT_TOP "墨笔生花会安装到所选位置下的 mobish 文件夹中，例如选择 D:\ 会安装到 D:\mobish。$\r$\n$\r$\n要安装到其他位置，单击 [浏览(B)...]；单击 [安装(I)] 开始安装。"
