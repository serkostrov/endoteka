/** Открывает системный диалог выбора файлов вне React-дерева (меню/sheet не успевают размонтировать input). */
export function pickImageFiles(options: {
  accept: string
  multiple?: boolean
}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = options.accept
    input.multiple = Boolean(options.multiple)
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    input.style.top = '0'
    input.style.opacity = '0'
    input.style.pointerEvents = 'none'

    let settled = false
    const finish = (files: File[]) => {
      if (settled) {
        return
      }
      settled = true
      window.removeEventListener('focus', onWindowFocus)
      input.remove()
      resolve(files)
    }

    const onWindowFocus = () => {
      // После закрытия диалога без выбора onchange может не сработать.
      window.setTimeout(() => {
        if (!settled) {
          finish([])
        }
      }, 400)
    }

    input.addEventListener('change', () => {
      finish(Array.from(input.files ?? []))
    })
    input.addEventListener('cancel', () => {
      finish([])
    })

    document.body.appendChild(input)
    window.addEventListener('focus', onWindowFocus)
    input.click()
  })
}
