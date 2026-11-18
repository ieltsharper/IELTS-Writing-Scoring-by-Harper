// Delete button for an essay, so the teacher can have it submitted again.
import { api } from '../../api';
import { h, replace } from '../../dom';
import { busy, confirmDialog, errorBox, toast } from '../../ui/components';

/** Asks for confirmation, deletes the essay, then calls onDeleted. Errors show next to the button. */
export function deleteEssayButton(
  essay: { id: string; topic: string; studentName: string },
  onDeleted: () => void,
  className = 'btn btn-small btn-danger',
): { button: HTMLElement; status: HTMLElement } {
  const button = h('button', { type: 'button', class: className }, 'Delete');
  const status = h('span', { 'aria-live': 'polite' });
  button.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Delete this essay?',
      message: `“${essay.topic}” by ${essay.studentName}, with its score, feedback and error log, will be removed and its Drive folder moved to the trash. This cannot be undone.`,
      confirmLabel: 'Delete essay',
      danger: true,
    });
    if (!ok) return;
    await busy(button, 'Deleting…', async () => {
      try {
        await api('admin.essays.delete', { essayId: essay.id });
        toast('Essay deleted.');
        onDeleted();
      } catch (err) {
        replace(status, errorBox(err));
      }
    });
  });
  return { button, status };
}
