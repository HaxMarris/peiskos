// The hearth league: a season of points each month from the games at the fire, the fishing derby
// and the casino. This is its standings page, the points someone hears about after a game, the
// champion's pennant at the hearth's fires, and the trophies on a profile card.

const TROPHY_ICON = '<svg class="trophy-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 4h10v3a5 5 0 0 1-10 0V4Z" fill="currentColor"/><path d="M7 5H4.5a.5.5 0 0 0-.5.5C4 8 5.6 9.6 7.6 10M17 5h2.5a.5.5 0 0 1 .5.5c0 2.5-1.6 4.1-3.6 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M11 12h2v4h-2zM8 19.5c0-1.4 1.8-2.5 4-2.5s4 1.1 4 2.5V20H8v-.5Z" fill="currentColor"/></svg>';
const LEAGUE_SOURCES = [['games', 'Games'], ['fishing', 'Fishing'], ['casino', 'Casino']];

/** "November 2026" from "2026-11". */
function leagueMonthName(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 15).toLocaleDateString([], { month: 'long', year: 'numeric' });
}

/** Someone scored in a game at the fire. */
function onLeaguePoints(ev) {
  const s = roomById(ev.channelId)?.s;
  if (!s?.league?.on) return;
  toast(`+${ev.points} league point${ev.points === 1 ? '' : 's'} in ${s.name}`, { action: 'Standings', onAction: () => openLeague(s.id) });
}

async function openLeague(serverId) {
  const s = state.servers.get(serverId);
  if (!s) return;
  modal(`<h2>League in ${escapeHtml(s.name)}</h2><div id="league-body">${placeholder('cards', 3)}</div>`, 'league-modal');
  let L;
  try {
    L = await api(`/api/servers/${serverId}/league`);
  } catch (err) {
    if ($('#league-body')) $('#league-body').innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    return;
  }
  const body = $('#league-body');
  if (!body) return;
  const top = L.standings[0]?.points ?? 0;
  const days = Math.max(0, Math.ceil((L.season.endsAt - Date.now()) / 864e5));
  const when = L.season.finalNight
    ? 'Championship night: points count double until midnight Eastern.'
    : `Ends in ${days} day${days === 1 ? '' : 's'}. The last day is championship night, when points count double.`;
  const row = (r, i) => {
    const split = LEAGUE_SOURCES.filter(([k]) => r[k] > 0)
      .map(([k]) => `<span class="league-part ${k}" style="flex:${r[k]}"></span>`).join('');
    const parts = LEAGUE_SOURCES.filter(([k]) => r[k] > 0).map(([k, label]) => `${label} ${r[k]}`).join(', ');
    return `<li${r.userId === state.me.id ? ' class="me"' : ''}>
      <span class="leader-rank">${i + 1}</span><span class="avatar xs" data-av="${r.userId}"></span>
      <span class="leader-name"><b>${escapeHtml(nameOf(r.userId, 'Someone'))}</b>
        <span class="league-bar" style="width:${Math.max(8, Math.round((r.points / (top || 1)) * 100))}%" role="img" aria-label="${escapeHtml(parts)}">${split}</span></span>
      <span class="leader-chips"><b>${r.points}</b><span class="small muted">point${r.points === 1 ? '' : 's'}</span></span></li>`;
  };
  const past = L.past.length
    ? `<h3>Champions</h3><ul class="league-past">${L.past.map((p) => `<li>${TROPHY_ICON}<span><b>${p.championId ? escapeHtml(nameOf(p.championId, 'Someone')) : 'Nobody'}</b>
        <span class="small muted">Season ${p.number}, ${escapeHtml(leagueMonthName(p.month))}${p.points ? `, ${p.points} points` : ''}</span></span></li>`).join('')}</ul>`
    : '';
  body.innerHTML = `
    ${L.on ? '' : '<p class="league-off">The league is off in this hearth. Nobody gets points until it’s back on.</p>'}
    <div class="league-season">
      <span class="league-season-name">Season ${L.season.number}</span>
      <span class="muted">${escapeHtml(leagueMonthName(L.season.month))}</span>
      <p class="small ${L.season.finalNight ? 'league-final' : 'muted'}">${escapeHtml(when)}</p>
    </div>
    ${L.standings.length ? `<ol class="leaders league-standings">${L.standings.map(row).join('')}</ol>
      <p class="league-key small muted">${LEAGUE_SOURCES.map(([k, label]) => `<span><i class="league-part ${k}"></i>${label}</span>`).join('')}</p>`
      : `<p class="muted">No points yet this season. Finish a game at the fire, enter the fishing derby or win at the casino.</p>`}
    <details class="league-rules"><summary>How points work</summary>
      <ul class="small">
        <li>Games at the fire: ${L.rules.games[0]} for first, ${L.rules.games[1]} for second, ${L.rules.games[2]} for everyone else who played. A game nobody wins is ${L.rules.games[2]} each. Up to ${L.rules.cap.games} a day.</li>
        <li>Fishing derby: ${L.rules.derby.slice(0, 3).join(', ')} for the top three each week, ${L.rules.derby[3]} for everyone else who entered.</li>
        <li>Casino: 1 for each win (a hand, a spin that pays more than the bet, a pot, a battle). Up to ${L.rules.cap.casino} a day.</li>
        <li>On championship night everything counts double. The champion gets a trophy on their profile and their name at this hearth’s fires next season.</li>
      </ul>
    </details>
    ${past}
    ${L.canChange ? `<label class="check league-toggle"><input type="checkbox" id="league-on" ${L.on ? 'checked' : ''} /> Keep the league in this hearth</label><div class="error" id="modal-error"></div>` : ''}`;
  body.querySelectorAll('[data-av]').forEach((el) => setAvatar(el, nameOf(Number(el.dataset.av), 'Someone'), avatarOf(Number(el.dataset.av))));
  const toggle = $('#league-on');
  if (toggle) toggle.onchange = async () => {
    try {
      await api(`/api/servers/${serverId}/league`, { method: 'PUT', body: { on: toggle.checked } });
      openLeague(serverId);
    } catch (err) {
      toggle.checked = !toggle.checked;
      $('#modal-error').textContent = err.message;
    }
  };
}

/**
 * Last season's champion on a pennant at the fire, through the season after. Called by renderFire
 * with the fire's circle.
 */
function leagueBannerScene(ring, s) {
  const c = s && !isDm(s) && s.league?.on ? s.league.champion : null;
  let flag = ring.querySelector('.league-pennant');
  if (!c) return flag?.remove();
  if (!flag) {
    flag = document.createElement('button');
    flag.type = 'button';
    flag.className = 'league-pennant';
    flag.innerHTML = `<span class="league-pole" aria-hidden="true"></span><span class="league-cloth">${TROPHY_ICON}<b></b><small></small></span>`;
    ring.append(flag);
  }
  const name = nameOf(c.userId, 'Someone');
  flag.querySelector('b').textContent = name;
  flag.querySelector('small').textContent = `Season ${c.season} champion`;
  flag.setAttribute('aria-label', `${name} is the season ${c.season} champion. Open the league`);
  flag.title = `${name}, season ${c.season} champion`;
  flag.classList.toggle('final', !!s.league.finalNight);
  flag.onclick = (ev) => { ev.stopPropagation(); openLeague(s.id); };
}

/** The trophies on a profile card: seasons won in hearths you're in too. */
function trophiesHtml(trophies) {
  if (!trophies?.length) return '';
  return `<span class="small muted achievements-count">League trophies</span><ul class="trophies">${trophies.map((t) =>
    `<li>${TROPHY_ICON}<span>${escapeHtml(t.hearth)}, season ${t.season}, <span class="muted">${escapeHtml(leagueMonthName(t.month))}</span></span></li>`).join('')}</ul>`;
}
