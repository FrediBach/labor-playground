/** Narrow RP2 1.20 corrections to micropython-rp2-pico-stubs 1.20.0.post5.
 * Sources: MicroPython v1.20.0 ports/rp2/machine_pin.c, machine_pwm.c and
 * extmod/machine_pwm.c. Runtime contract tests exercise these signatures.
 * Preserve upstream documentation; replace permissive or port-generic signatures.
 */
export function overlayMachineStub(source: string): string {
  let text = source.replace('from typing import Callable,', 'from typing import overload, Callable,')
  text = text.replace('def __init__(self, id, mode=-1, pull=-1, *, value=None, drive=0, alt=-1) -> None:', 'def __init__(self, id: int | str, mode: int | None = None, pull: int | None = None, *, value: object = None, alt: int = 5) -> None:')
  text = text.replace('def init(self, mode=-1, pull=-1, *, value=None, drive=0, alt=-1) -> None:', 'def init(self, mode: int | None = None, pull: int | None = None, *, value: object = None, alt: int = 5) -> None:')
  text = text.replace('def toggle(self, *args, **kwargs) -> Any:', 'def toggle(self) -> None:')
  text = text.replace('def __init__(self, dest, *, freq=0, duty=0, duty_u16=0, duty_ns=0) -> None:', 'def __init__(self, dest: Pin | int, /) -> None:')
  const start = text.indexOf('class PWM:')
  const end = text.indexOf('\nclass ', start + 1)
  let pwm = text.slice(start, end)
  for (const name of ['freq', 'duty_u16', 'duty_ns']) {
    const signature = name === 'freq' ? 'Incomplete' : 'int'
    pwm = pwm.replace(`    def ${name}(self, value: Optional[Any] = None) -> ${signature}:`, `    @overload\n    def ${name}(self) -> int: ...\n    @overload\n    def ${name}(self, value: int, /) -> None:`)
  }
  return text.slice(0, start) + pwm + text.slice(end)
}
