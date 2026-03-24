window.VAST_MONITOR_EXTENSION = {
  onStatusPayload(status) {
    if (!status || !Array.isArray(status.machines)) {
      return;
    }

    const existing = document.getElementById("company-plugin-banner");
    if (existing) {
      existing.remove();
    }

    const machinesWithAnnotations = status.machines.filter((machine) => Array.isArray(machine.company_annotations) && machine.company_annotations.length > 0);
    if (machinesWithAnnotations.length === 0) {
      return;
    }

    const banner = document.createElement("section");
    banner.id = "company-plugin-banner";
    banner.className = "panel company-plugin-panel";
    const assignedMachines = machinesWithAnnotations
      .slice(0, 6)
      .map((machine) => `
        <li>
          <strong>${escapeHtml(machine.hostname || `#${machine.machine_id}`)}</strong>
          <span>${escapeHtml(formatAssignment(machine))}</span>
        </li>
      `)
      .join("");
    banner.innerHTML = `
      <div class="panel-title-row">
        <h2>Company Rules</h2>
        <span class="section-meta">Plugin extension</span>
      </div>
      <p>${machinesWithAnnotations.length} machine(s) have owner/team assignments.</p>
      <ul class="company-plugin-list">${assignedMachines}</ul>
    `;

    const dashboard = document.querySelector(".dashboard");
    if (dashboard) {
      dashboard.prepend(banner);
    }
  }
};

function formatAssignment(machine) {
  if (machine.owner_name && machine.team_name) {
    return `${machine.owner_name} / ${machine.team_name}`;
  }
  return machine.owner_name || machine.team_name || "Unassigned";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
