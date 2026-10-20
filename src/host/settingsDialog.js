// Ajustes de la partida (se guardan con la sala).
import { h } from '../shared/dom.js';

const FIELDS = [
  { key: 'pointsForCorrect', type: 'number', label: 'Puntos por acierto', min: -10, max: 10 },
  { key: 'pointsForWrong', type: 'number', label: 'Puntos por fallo', min: -10, max: 10, help: 'Pon un número negativo para restar.' },
  { key: 'lockEarlyBuzz', type: 'checkbox', label: 'Bloquear durante la pregunta a quien pulse antes de abrir el turno' },
  { key: 'nearTieMs', type: 'number', label: 'Umbral de casi empate (ms)', min: 0, max: 500 },
  {
    key: 'decisionWindowMs',
    type: 'number',
    label: 'Ventana de decisión (ms)',
    min: 0,
    max: 1000,
    help: 'Tras la primera pulsación que llega, se espera esto antes de declarar ganador.',
  },
  {
    key: 'scheduledOpenMs',
    type: 'number',
    label: 'Apertura programada (ms)',
    min: 0,
    max: 2000,
    help: 'Retraso entre pulsar "Abrir turno" y que empiece el turno en tele y móviles.',
  },
];

export function openSettingsDialog(room) {
  const inputs = new Map();
  const form = h(
    'form',
    { method: 'dialog', class: 'settings-form' },
    h('h2', {}, 'Ajustes'),
    FIELDS.map((f) => {
      const input = h('input', { type: f.type, name: f.key, min: f.min, max: f.max, step: 1 });
      if (f.type === 'checkbox') input.checked = !!room.settings[f.key];
      else input.value = room.settings[f.key];
      inputs.set(f.key, { input, field: f });
      return h(
        'label',
        { class: `setting ${f.type}` },
        h('span', { class: 'setting-label' }, f.label, f.help ? h('small', {}, f.help) : null),
        input,
      );
    }),
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { class: 'btn', value: 'cancel' }, 'Cancelar'),
      h('button', { class: 'btn primary', value: 'save' }, 'Guardar'),
    ),
  );
  const dialog = h('dialog', { class: 'settings-dialog' }, form);
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'save') {
      const patch = {};
      for (const [key, { input, field }] of inputs) {
        if (field.type === 'checkbox') patch[key] = input.checked;
        else {
          const n = Math.round(Number(input.value));
          if (Number.isFinite(n)) patch[key] = Math.min(field.max, Math.max(field.min, n));
        }
      }
      room.updateSettings(patch);
    }
    dialog.remove();
  });
  document.body.append(dialog);
  dialog.showModal();
}
