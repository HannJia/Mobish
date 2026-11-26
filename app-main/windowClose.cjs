function closeDialogOptions({ dirty, inspiration }) {
  return {
    type: 'warning',
    title: '退出墨笔生花？',
    message: dirty ? '当前页面还有未保存的修改。' : '确定退出墨笔生花吗？',
    ...(dirty ? { detail: '继续退出会丢弃这些修改。已保存的灵感对话和输入框草稿可从历史会话恢复。' }
      : inspiration ? { detail: '灵感对话草稿已保存，可从「历史会话」找回。' } : {}),
    buttons: ['继续编辑', '退出'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }
}

function finishWindowClose(window, dialog, context, approve) {
  if (context && dialog.showMessageBoxSync(window, closeDialogOptions(context)) !== 1) return false
  approve(context ? 'confirmed' : 'saved')
  window.close()
  return true
}

function approveWindowUnload(event, window, dialog, approval, reset) {
  if (approval === 'discard' || approval === 'confirmed' || approval === 'update') {
    event.preventDefault()
  } else if (approval === 'saved') {
    if (dialog.showMessageBoxSync(window, closeDialogOptions({ dirty: true })) === 1) event.preventDefault()
    else reset()
  }
}

module.exports = { finishWindowClose, approveWindowUnload }
