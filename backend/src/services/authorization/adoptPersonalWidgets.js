/**
 * Move a person's widgets from their personal space into the team library, keeping every id.
 *
 * Before tools and the REST API shared one library (teamAssetOwner.js), widgets made from a teammate's chat
 * were saved under that person; on a team instance the Widgets page and /widget-definitions read only the
 * team's library, so those widgets showed in list_widgets and nowhere else (bravo, cw_dea6a39e0933). Every
 * widget surface calls this first, for the person acting, so both always show the same widgets.
 *
 * Owner and scope are immutable columns (OwnershipTriggers), so a row is re-inserted under the team owner
 * with INSERT OR REPLACE: one statement, so atomic; the insert trigger assigns the team scope. Same id, so
 * canvas layouts that place the widget keep working.
 */
export async function adoptPersonalWidgets(repository, personalId, teamOwner) {
  if (!personalId || !teamOwner || personalId === teamOwner) return 0;
  const rows = await repository.all('SELECT * FROM widget_definitions WHERE user_id = ?', [personalId]);
  if (!rows.length) return 0;
  const columns = (await repository.all('PRAGMA table_info(widget_definitions)')).map((column) => column.name).filter((name) => name !== 'scope_id');
  const quoted = columns.map((name) => `"${name}"`).join(', ');
  const marks = columns.map(() => '?').join(', ');
  let moved = 0;
  for (const row of rows) {
    const values = columns.map((name) => (name === 'user_id' ? teamOwner : row[name]));
    await repository.run(`INSERT OR REPLACE INTO widget_definitions (${quoted}) VALUES (${marks})`, values);
    moved += 1;
  }
  return moved;
}
