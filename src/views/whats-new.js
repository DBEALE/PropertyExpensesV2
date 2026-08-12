/**
 * What has changed in the app, newest first. The content lives in
 * `../whats-new.js` so that adding a feature means adding a paragraph of prose
 * rather than editing a view.
 */
import { el, ukDate } from '../dom.js';
import { RELEASES } from '../whats-new.js';

export function renderWhatsNew(root) {
  root.append(
    el('div', { class: 'toolbar' }, el('h2', {}, 'What’s new')),
    el(
      'p',
      { class: 'hint' },
      'Every change worth knowing about, newest first. Nothing here is sent anywhere — this is a ' +
        'list kept inside the app, not a feed.',
    ),
  );

  if (RELEASES.length === 0) {
    root.append(el('div', { class: 'empty' }, 'Nothing recorded yet.'));
    return;
  }

  root.append(
    el(
      'ol',
      { class: 'releases' },
      ...RELEASES.map((release) =>
        el(
          'li',
          { class: 'release' },
          el(
            'div',
            { class: 'release-head' },
            el('h3', {}, release.title),
            el('time', { class: 'count', datetime: release.date }, ukDate(release.date)),
          ),
          el('ul', { class: 'release-points' }, ...release.points.map((point) => el('li', {}, point))),
        ),
      ),
    ),
  );
}
