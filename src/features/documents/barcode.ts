const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
] as const

const START_B = 104
const STOP = 106

function code128Index(charCode: number) {
  if (charCode < 32 || charCode > 126) {
    return null
  }
  return charCode - 32
}

export function toCode128Payload(value: string) {
  let payload = ''
  for (const char of value) {
    if (code128Index(char.charCodeAt(0)) !== null) {
      payload += char
    }
  }
  return payload
}

export function buildCode128Path(value: string) {
  const payload = toCode128Payload(value)
  if (!payload) {
    return null
  }

  const codes = [START_B]
  for (const char of payload) {
    const index = code128Index(char.charCodeAt(0))
    if (index === null) {
      return null
    }
    codes.push(index)
  }

  let checksum = START_B
  payload.split('').forEach((char, index) => {
    checksum += (code128Index(char.charCodeAt(0)) ?? 0) * (index + 1)
  })
  codes.push(checksum % 103)
  codes.push(STOP)

  const modules: number[] = []
  let bar = true
  for (const code of codes) {
    const pattern = PATTERNS[code]
    if (!pattern) {
      return null
    }
    for (const width of pattern) {
      const size = Number(width)
      for (let index = 0; index < size; index += 1) {
        modules.push(bar ? 1 : 0)
      }
      bar = !bar
    }
    bar = true
  }

  const quiet = 10
  const height = 40
  const bars: string[] = []
  modules.forEach((bit, index) => {
    if (bit === 1) {
      bars.push(`M${quiet + index} 0 V${height}`)
    }
  })

  return {
    width: modules.length + quiet * 2,
    height,
    d: bars.join(' '),
    payload,
  }
}
