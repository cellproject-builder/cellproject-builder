import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, expect, it } from 'vitest';
import { ServoLab } from './ServoLab';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
function render(english = false) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(<ServoLab english={english} />));
}
function click(label: string) {
  const button = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes(label))!;
  expect(button).toBeTruthy(); act(() => Simulate.click(button));
}
function change(label: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  expect(input).toBeTruthy(); act(() => { input.value = value; Simulate.change(input); });
}
afterEach(() => { if (root) act(() => root.unmount()); host?.remove(); });

it('assembles and separates the servo layers and inspects a part using the keyboard', () => {
  render();
  const initial = host.querySelector('[data-servo-part="horn"]')!.getAttribute('transform');
  click('Montado');
  expect(host.querySelector('[data-servo-part="horn"]')!.getAttribute('transform')).not.toBe(initial);
  click('Explodido');
  const motor = host.querySelector('[data-servo-part="motor"]')!;
  act(() => Simulate.keyDown(motor, { key: 'Enter' }));
  expect(motor.getAttribute('aria-pressed')).toBe('true');
  expect(host.querySelector('[data-servo-inspector]')?.textContent).toContain('Motor DC');
});

it('changes the PWM illustration with the requested position and resets the whole experiment', () => {
  render(); click('Sinal e controle');
  change('Posição solicitada', '45');
  expect(host.querySelector('[data-pulse-width]')?.textContent).toContain('1.25');
  const path = host.querySelector('[data-pwm-wave]')!.getAttribute('d');
  change('Posição solicitada', '135');
  expect(host.querySelector('[data-pwm-wave]')!.getAttribute('d')).not.toBe(path);
  click('Reiniciar');
  expect(host.querySelector<HTMLInputElement>('[aria-label="Posição solicitada"]')?.value).toBe('90');
});

it('updates the load prediction and marks a scenario above the reference without claiming physical evidence', () => {
  render(); click('Carga e alcance');
  change('Massa da carga', '300'); change('Alcance do braço', '20');
  expect(host.querySelector('[data-torque-result]')?.textContent).toContain('0.589');
  expect(host.querySelector('output[aria-label="Momento estimado"]')?.textContent).toContain('0.589 N·m');
  expect(host.querySelector('[data-load-status]')?.getAttribute('data-exceeds')).toBe('true');
  expect(host.querySelector('[data-inclination-arc]')).toBeNull();
  change('Inclinação do braço', '90');
  expect(host.querySelector('[data-torque-result]')?.textContent).toContain('0.000');
  expect(host.querySelector('[data-inclination-arc]')?.getAttribute('d')).toBe('M212 290A27 27 0 0 0 185 263');
  expect(host.textContent).toContain('Massa do braço, atrito e aceleração não incluídos');
});

it('exposes the same controls in English', () => {
  render(true); click('Signal & control'); change('Requested position', '0');
  expect(host.querySelector('[data-pulse-width]')?.textContent).toContain('1.00');
});
