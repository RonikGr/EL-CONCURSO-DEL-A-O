// Ventana grande de la tele para preparar cosas (caras, música). Se repinta con refresh() cuando cambian los datos.
// Igual que en Ajustes: se cierra con el evento 'submit' del formulario (Chrome no siempre dispara 'close').
import { fill, h } from '../shared/dom.js';

export function openPanel({ title, render, onClose = null }) {
  const body = h('div', { class: 'panel-body' });
  const form = h(
    'form',
    { method: 'dialog', class: 'panel-form' },
    h('header', { class: 'panel-head' }, h('h2', {}, title), h('button', { class: 'btn', value: 'close' }, 'Cerrar')),
    body,
  );
  const dialog = h('dialog', { class: 'panel-dialog' }, form);
  const close = () => {
    if (!dialog.isConnected) return;
    dialog.close();
    dialog.remove();
    onClose?.();
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    close();
  });
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault(); // Escape
    close();
  });
  const refresh = () => {
    // conservar qué apartados estaban abiertos y el scroll al repintar
    const open = new Set([...body.querySelectorAll('details[open]')].map((d) => d.dataset.key));
    const top = body.scrollTop;
    fill(body, render());
    for (const d of body.querySelectorAll('details')) if (open.has(d.dataset.key)) d.open = true;
    body.scrollTop = top;
  };
  refresh();
  document.body.append(dialog);
  dialog.showModal();
  return { refresh, close, get isOpen() { return dialog.isConnected; } };
}

/** Zona donde soltar archivos (y que no los coja la tele como concurso .xlsx). */
export function dropZone(el, onFiles) {
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    el.classList.add('drop-over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('drop-over');
    if (e.dataTransfer?.files?.length) onFiles(e.dataTransfer.files);
  });
  return el;
}

/** Botón «Examinar…» con su selector de archivos oculto. */
export function browseButton(label, { accept, multiple = true, onFiles }) {
  const input = h('input', {
    type: 'file',
    accept,
    multiple,
    hidden: true,
    onchange: (e) => {
      if (e.target.files.length) onFiles(e.target.files);
      e.target.value = '';
    },
  });
  return [h('button', { class: 'btn small', type: 'button', onclick: () => input.click() }, label), input];
}
