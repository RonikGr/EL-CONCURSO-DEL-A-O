// Selector de nombre + color + icono. Se usa al entrar y en "Cambiar".
import { h } from '../shared/dom.js';
import { COLORS, ICONS, appearanceKey, getColor } from '../shared/appearance.js';
import { MAX_NAME_LENGTH } from '../core/players.js';

export function createProfilePicker(initial) {
  let value = { ...initial };
  let taken = new Set(); // parejas color|icono de los demás jugadores

  const nameInput = h('input', {
    class: 'name-input',
    maxlength: MAX_NAME_LENGTH,
    autocomplete: 'nickname',
    enterkeyhint: 'done',
    placeholder: 'Tu nombre',
  });
  nameInput.value = value.name ?? '';
  nameInput.addEventListener('input', () => (value.name = nameInput.value));

  const colorButtons = COLORS.map((c) =>
    h('button', {
      type: 'button',
      class: 'swatch',
      style: { background: c.bg },
      'aria-label': c.name,
      title: c.name,
      onclick: () => {
        value.color = c.id;
        refresh();
      },
    }),
  );

  const iconButtons = ICONS.map((i) =>
    h(
      'button',
      {
        type: 'button',
        class: 'icon-choice emoji',
        'aria-label': i.label,
        title: i.label,
        onclick: () => {
          value.icon = i.id;
          refresh();
        },
      },
      i.glyph,
    ),
  );

  const hint = h('p', { class: 'picker-hint' });
  const colorField = h('fieldset', { class: 'field' }, h('legend', {}, 'Color'), h('div', { class: 'swatches' }, colorButtons));

  const nameHint = h('p', { class: 'picker-hint', hidden: true }, 'El nombre ya no se puede cambiar: el concurso ha empezado.');
  const nameField = h('label', { class: 'field' }, h('span', {}, 'Tu nombre'), nameInput, nameHint);
  const iconField = h('fieldset', { class: 'field' }, h('legend', {}, 'Icono'), h('div', { class: 'icons' }, iconButtons));
  let fixedColor = false;
  let lookHidden = false;

  const root = h(
    'div',
    { class: 'picker' },
    nameField,
    colorField,
    iconField,
    hint,
  );

  function refresh() {
    const color = getColor(value.color);
    COLORS.forEach((c, i) => colorButtons[i].setAttribute('aria-pressed', String(c.id === value.color)));
    ICONS.forEach((icon, i) => {
      const btn = iconButtons[i];
      const selected = icon.id === value.icon;
      btn.setAttribute('aria-pressed', String(selected));
      btn.disabled = taken.has(appearanceKey(value.color, icon.id));
      btn.style.background = selected ? color.bg : '';
    });
    hint.textContent = taken.has(appearanceKey(value.color, value.icon))
      ? 'Esa combinación ya la tiene otro jugador: elige otro icono o color.'
      : '';
  }

  refresh();

  return {
    root,
    get value() {
      return { ...value, name: nameInput.value };
    },
    set value(v) {
      value = { ...v };
      nameInput.value = v.name ?? '';
      refresh();
    },
    setTaken(keys) {
      taken = new Set(keys);
      refresh();
    },
    /** Con equipos el color lo pone el equipo: se oculta la elección de color. `null` la vuelve a mostrar. */
    setFixedColor(colorId) {
      fixedColor = !!colorId;
      colorField.hidden = fixedColor || lookHidden;
      if (colorId) value.color = colorId;
      refresh();
    },
    focusName() {
      nameInput.focus();
    },
    /** Sin el nombre (pantalla de elegir icono y color tras entrar). */
    showName(on) {
      nameField.hidden = !on;
    },
    /** Sin icono ni color (al entrar se pide solo el nombre; quien tiene foto no los necesita). */
    showLook(on) {
      lookHidden = !on;
      iconField.hidden = lookHidden;
      colorField.hidden = lookHidden || fixedColor;
      hint.hidden = lookHidden;
    },
    /** Con el concurso empezado, el nombre no se cambia. */
    lockName(locked) {
      nameInput.disabled = locked;
      nameHint.hidden = !locked;
    },
  };
}
