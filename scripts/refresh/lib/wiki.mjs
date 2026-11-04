// Wikipedia's pages, read through its API, at their current revision or a
// fixed one (`oldid`), so what's read from them can link the exact version

/** A Wikipedia page's HTML, at its current revision or `oldid`, through its API */
export async function wikiPage(title, oldid = null) {
  const which = oldid ? { oldid: String(oldid) } : { page: title };
  const url = `https://en.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'parse', ...which, prop: 'text|revid', format: 'json', formatversion: '2' })}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'TaskForcePurple/1.0 (https://taskforcepurple.com)' },
  });
  const d = await res.json();
  if (!d.parse?.text) {
    throw new Error(`Wikipedia page ${title}: ${d.error?.info || res.status}`);
  }
  return { title: d.parse.title, revid: d.parse.revid, html: d.parse.text };
}
