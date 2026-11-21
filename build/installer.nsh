; 安装程序界面显示中文名。只改显示用的 PRODUCT_NAME；
; 程序文件名和安装目录仍用 mobish（由 PRODUCT_FILENAME 决定），卸载项注册表键由 APP_GUID 决定，也不变。
; “应用和功能”里的显示名由 package.json 的 nsis.uninstallDisplayName 设置。
; electron-builder 把本文件放在模板和提示语之前，所以窗口标题、底部版本栏和提示语都会使用这里的名字。
!undef PRODUCT_NAME
!define PRODUCT_NAME "墨笔生花"
