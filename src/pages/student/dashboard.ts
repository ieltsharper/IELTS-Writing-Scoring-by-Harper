// Progress dashboard (charts and highlights are added in build step 7).
import { link, page } from '../../ui/components';

export function dashboardPage(): Node {
  return page('Dashboard', link('/new', 'Start a new essay', { class: 'btn btn-primary' }));
}
