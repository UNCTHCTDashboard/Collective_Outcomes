document.addEventListener("DOMContentLoaded", () => {
  const warningBox = document.getElementById("data-warning");

  if (
    typeof CO_DATA === "undefined" ||
    !CO_DATA.durableSolutions ||
    !Array.isArray(CO_DATA.durableSolutions.records)
  ) {
    showWarning("Durable Solutions data was not loaded. Please make sure CO_DATA.durableSolutions.records exists in js/data.js.");
    return;
  }

  let currentCategory = "DS-BS";

  const CATEGORY_LABELS = {
    "DS-BS": "DS Basic Services",
    "DS-LHE": "DS Livelihoods & Economic Inclusion",
    "DS-Sec": "DS Security"
  };

  const ADMIN_AREAS = CO_DATA.durableSolutions.adminAreas || [
    "Abyei Region",
    "Pibor Administrative Area",
    "Ruweng Administrative Area",
    "Abyei",
    "Pibor",
    "Ruweng"
  ];

  const records = CO_DATA.durableSolutions.records.map(normalizeRecord);

  const indicatorFilter = document.getElementById("indicator-filter");
  const agencyFilter = document.getElementById("agency-filter");
  const stateFilter = document.getElementById("state-filter");
  const countyFilter = document.getElementById("county-filter");
  const resetBtn = document.getElementById("reset-filters");

  let durableMap = null;
  let countyLayer = null;
  let countyGeoJson = null;
  let mapInitialized = false;

  function clean(value) {
    const v = value === undefined || value === null ? "" : String(value).trim();
    return v || "Unknown";
  }

  function toNumber(value) {
    if (value === undefined || value === null || value === "") return 0;
    const n = Number(String(value).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }

  function normalizeRecord(r) {
    return {
      category: clean(r.category),
      sector: clean(r.sector),
      indicator: clean(r.indicator),
      supportType: clean(r.supportType),
      agency: clean(r.agency),
      state: clean(r.state),
      county: clean(r.county),
      period: clean(r.period),
      current: toNumber(r.current),
      male: toNumber(r.male),
      female: toNumber(r.female),
      idps: toNumber(r.idps),
      returnees: toNumber(r.returnees),
      hostCommunity: toNumber(r.hostCommunity)
    };
  }

  function beneficiaryValue(r) {
    return Number(r.male || 0) + Number(r.female || 0);
  }

  // Main Durable Solutions metric:
  // Use the Number/current column for reported achievement/value.
  // Male/female remains available as a separate disaggregation where applicable.
  function reportedValue(r) {
    return Number(r.current || 0);
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, m => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[m]));
  }

  function normText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normName(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/\s+county$/i, "")
      .replace("pibor administrative area", "pibor")
      .replace("ruweng administrative area", "ruweng")
      .replace("abyei region", "abyei");
  }

  function uniqueSorted(arr) {
    return [...new Set(arr.filter(v => v && v !== "Unknown"))].sort((a, b) =>
      a.localeCompare(b)
    );
  }

  function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;

  const target = Number(String(value).replace(/,/g, ""));

  if (isNaN(target)) {
    el.textContent = value;
    return;
  }

  animateCount(el, target);
}

function animateCount(el, target) {
  const duration = 900;
  const startTime = performance.now();
  const startValue = 0;

  function update(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.floor(startValue + (target - startValue) * eased);

    el.textContent = current.toLocaleString();

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      el.textContent = target.toLocaleString();
    }
  }

  requestAnimationFrame(update);
}

  function setOptions(select, values, allLabel = "All") {
    if (!select) return;

    const current = select.value || "All";

    select.innerHTML =
      `<option value="All">${allLabel}</option>` +
      values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");

    select.value = [...select.options].some(o => o.value === current) ? current : "All";
  }

  function categoryRecords() {
    return records.filter(r => r.category === currentCategory);
  }

  function isGeoRow(r) {
    const state = normText(r.state);
    const county = normText(r.county);

    return !(
      state === "country wide" ||
      state === "countrywide" ||
      county === "nationwide" ||
      state === "unknown" ||
      county === "unknown"
    );
  }

  function geoRows(rows) {
    return rows.filter(isGeoRow);
  }

  function getFilteredRecords() {
    const indicator = indicatorFilter.value || "All";
    const agency = agencyFilter.value || "All";
    const state = stateFilter.value || "All";
    const county = countyFilter.value || "All";

    return categoryRecords().filter(r =>
      (indicator === "All" || r.indicator === indicator) &&
      (agency === "All" || r.agency === agency) &&
      (state === "All" || r.state === state) &&
      (county === "All" || r.county === county)
    );
  }

  function filterRowsForOptions(excludeFilter = "") {
    const indicator = indicatorFilter.value || "All";
    const agency = agencyFilter.value || "All";
    const state = stateFilter.value || "All";
    const county = countyFilter.value || "All";

    return categoryRecords().filter(r =>
      (excludeFilter === "indicator" || indicator === "All" || r.indicator === indicator) &&
      (excludeFilter === "agency" || agency === "All" || r.agency === agency) &&
      (excludeFilter === "state" || state === "All" || r.state === state) &&
      (excludeFilter === "county" || county === "All" || r.county === county)
    );
  }

  function refreshDependentFilters(changedFilter = "") {
    if (changedFilter === "category") {
      indicatorFilter.value = "All";
      agencyFilter.value = "All";
      stateFilter.value = "All";
      countyFilter.value = "All";
    }

    const previousValues = {
      indicator: indicatorFilter.value || "All",
      agency: agencyFilter.value || "All",
      state: stateFilter.value || "All",
      county: countyFilter.value || "All"
    };

    const indicatorOptions = uniqueSorted(filterRowsForOptions("indicator").map(r => r.indicator));
    setOptions(indicatorFilter, indicatorOptions, "All Indicators");
    indicatorFilter.value = indicatorOptions.includes(previousValues.indicator) ? previousValues.indicator : "All";

    const agencyOptions = uniqueSorted(filterRowsForOptions("agency").map(r => r.agency));
    setOptions(agencyFilter, agencyOptions, "All Agencies");
    agencyFilter.value = agencyOptions.includes(previousValues.agency) ? previousValues.agency : "All";

    const stateOptions = uniqueSorted(geoRows(filterRowsForOptions("state")).map(r => r.state));
    setOptions(stateFilter, stateOptions, "All States/Admin Areas");
    stateFilter.value = stateOptions.includes(previousValues.state) ? previousValues.state : "All";

    const countyOptions = uniqueSorted(geoRows(filterRowsForOptions("county")).map(r => r.county));
    setOptions(countyFilter, countyOptions, "All Counties");
    countyFilter.value = countyOptions.includes(previousValues.county) ? previousValues.county : "All";
  }

  function groupSum(rows, field, useBeneficiaries = false) {
    return rows.reduce((out, r) => {
      const key = r[field] || "Unknown";
      out[key] = (out[key] || 0) + (useBeneficiaries ? reportedValue(r) : Number(r.current || 0));
      return out;
    }, {});
  }

  function groupIndicators(rows) {
    const grouped = {};

    rows.forEach(r => {
      if (!grouped[r.indicator]) {
        grouped[r.indicator] = {
          indicator: r.indicator,
          agencies: new Set(),
          current: 0,
          beneficiaries: 0
        };
      }

      grouped[r.indicator].agencies.add(r.agency);
      grouped[r.indicator].current += Number(r.current || 0);
      grouped[r.indicator].beneficiaries += reportedValue(r);
    });

    return Object.values(grouped).sort((a, b) => b.current - a.current);
  }

  function groupCountyFull(rows) {
    const grouped = {};

    rows.forEach(r => {
      const key = normName(r.county);
      if (!key || key === "unknown") return;

      if (!grouped[key]) {
        grouped[key] = {
          county: r.county,
          state: r.state,
          agencies: new Set(),
          indicators: new Set(),
          current: 0,
          male: 0,
          female: 0,
          idps: 0,
          returnees: 0,
          hostCommunity: 0
        };
      }

      grouped[key].agencies.add(r.agency);
      grouped[key].indicators.add(r.indicator);

      // For map and map summary, current = reported value from the Number/current column
      grouped[key].current += reportedValue(r);

      grouped[key].male += r.male;
      grouped[key].female += r.female;
      grouped[key].idps += r.idps;
      grouped[key].returnees += r.returnees;
      grouped[key].hostCommunity += r.hostCommunity;
    });

    return grouped;
  }

  function renderKpis(rows) {
    const rowsForGeo = geoRows(rows);
    const hasSingleIndicator = isSingleIndicatorSelected();
    const peopleBased = hasSingleIndicator && isPeopleBasedSelection(rowsForGeo);

    const states = new Set();
    const adminAreas = new Set();
    const counties = new Set();
    const agencies = new Set();

    rowsForGeo.forEach(r => {
      if (ADMIN_AREAS.includes(r.state)) {
        adminAreas.add(r.state);
      } else if (r.state !== "Unknown") {
        states.add(r.state);
      }

      if (r.county !== "Unknown") counties.add(r.county);
      if (r.agency !== "Unknown") agencies.add(r.agency);
    });

    setText("snapshot-title", `${CATEGORY_LABELS[currentCategory]} Snapshot`);
    setText("kpi-states", fmt(states.size));
    setText("kpi-admin-areas", fmt(adminAreas.size));
    setText("kpi-counties", fmt(counties.size));
    setText("kpi-agencies", fmt(agencies.size));
    setText("kpi-current-label", "Reported Value");

    if (hasSingleIndicator) {
      setText("kpi-current", fmt(rowsForGeo.reduce((s, r) => s + reportedValue(r), 0)));
      setText("kpi-current-sub", `Number column · ${metricLabel(rowsForGeo, true)}`);
    } else {
      setText("kpi-current", "—");
      setText("kpi-current-sub", "select one indicator");
    }

    if (peopleBased) {
      setText("kpi-male", fmt(rowsForGeo.reduce((s, r) => s + r.male, 0)));
      setText("kpi-female", fmt(rowsForGeo.reduce((s, r) => s + r.female, 0)));
      setText("kpi-male-sub", "reported male");
      setText("kpi-female-sub", "reported female");
    } else {
      setText("kpi-male", "—");
      setText("kpi-female", "—");
      setText("kpi-male-sub", hasSingleIndicator ? "not applicable" : "select one indicator");
      setText("kpi-female-sub", hasSingleIndicator ? "not applicable" : "select one indicator");
    }
  }

  function selectedIndicatorLabel() {
    return indicatorFilter?.value && indicatorFilter.value !== "All" ? indicatorFilter.value : "";
  }

  function isSingleIndicatorSelected() {
    return selectedIndicatorLabel() !== "";
  }

  function indicatorUnitLabel(plural = true) {
    const indicatorText = selectedIndicatorLabel().toLowerCase();

    if (!indicatorText) return "reported value";
    if (indicatorText.includes("km") || indicatorText.includes("dyke") || indicatorText.includes("drainage")) return "km";
    if (indicatorText.includes("consultation")) return plural ? "consultations" : "consultation";
    if (indicatorText.includes("official")) return plural ? "government officials" : "government official";
    if (indicatorText.includes("phcc") || indicatorText.includes("school")) return plural ? "facilities/schools" : "facility/school";
    if (indicatorText.includes("desk")) return plural ? "desks" : "desk";
    if (indicatorText.includes("roadmap")) return plural ? "roadmaps/action plans" : "roadmap/action plan";
    if (indicatorText.includes("mechanism")) return plural ? "coordination mechanisms" : "coordination mechanism";
    if (indicatorText.includes("counselling") || indicatorText.includes("counseling")) return plural ? "people counselled" : "person counselled";

    const peopleKeywords = [
      "people", "person", "persons", "individual", "individuals", "benefit", "beneficiaries",
      "displacement-affected", "idp", "returnee", "host community", "household", "households"
    ];
    if (peopleKeywords.some(k => indicatorText.includes(k))) return plural ? "beneficiaries" : "beneficiary";

    return "reported value";
  }

  function isPeopleBasedSelection(rows) {
    const label = indicatorUnitLabel(true);
    return label === "beneficiaries" || label === "people counselled" || label === "government officials";
  }

  function shouldShowPopulationGroups(rows) {
    if (!isSingleIndicatorSelected()) return false;

    const indicatorText = selectedIndicatorLabel().toLowerCase();

    // Population-group charts are useful only when the selected indicator represents people/beneficiaries.
    // Do not show for infrastructure, facilities, consultations, officials, km, desks, roadmaps or mechanisms.
    const nonPopulationKeywords = [
      "km",
      "dyke",
      "dykes",
      "drainage",
      "phcc",
      "school",
      "schools",
      "consultation",
      "consultations",
      "official",
      "officials",
      "desk",
      "desks",
      "roadmap",
      "roadmaps",
      "mechanism",
      "mechanisms"
    ];

    if (nonPopulationKeywords.some(k => indicatorText.includes(k))) return false;

    const label = indicatorUnitLabel(true);
    const isPeopleIndicator = label === "beneficiaries" || label === "people counselled";
    const hasPopulationData = rows.some(r =>
      Number(r.idps || 0) > 0 ||
      Number(r.returnees || 0) > 0 ||
      Number(r.hostCommunity || 0) > 0
    );

    return isPeopleIndicator && hasPopulationData;
  }

  function metricLabel(rows, plural = true) {
    if (!isSingleIndicatorSelected()) return "reported value";
    return indicatorUnitLabel(plural);
  }

  function renderSimpleInsights(rows, rowsForGeo) {
    const container = document.getElementById("simple-insights-list");
    if (!container) return;

    const totalValue = rowsForGeo.reduce((s, r) => s + reportedValue(r), 0);
    const label = metricLabel(rowsForGeo, true);
    const hasSingleIndicator = isSingleIndicatorSelected();

    if (!rowsForGeo.length) {
      container.innerHTML = `<div class="simple-insight-item">No records match the selected filters.</div>`;
      return;
    }

    const stateTotals = groupSum(rowsForGeo, "state", true);
    const countyTotals = groupSum(rowsForGeo, "county", true);
    const agencyTotals = groupSum(rowsForGeo, "agency", true);

    const topState = Object.entries(stateTotals).filter(([n, v]) => n && n !== "Unknown" && v > 0).sort((a, b) => b[1] - a[1])[0];
    const topCounty = Object.entries(countyTotals).filter(([n, v]) => n && n !== "Unknown" && v > 0).sort((a, b) => b[1] - a[1])[0];
    const topAgency = Object.entries(agencyTotals).filter(([n, v]) => n && n !== "Unknown" && v > 0).sort((a, b) => b[1] - a[1])[0];

    const entityCount = new Set(rowsForGeo.map(r => r.agency).filter(a => a && a !== "Unknown")).size;
    const countyCount = new Set(rowsForGeo.map(r => r.county).filter(c => c && c !== "Unknown")).size;
    const stateCount = new Set(rowsForGeo.map(r => r.state).filter(s => s && s !== "Unknown")).size;
    const indicatorCount = new Set(rowsForGeo.map(r => r.indicator).filter(i => i && i !== "Unknown")).size;

    if (!hasSingleIndicator) {
      container.innerHTML = `
        <div class="simple-insight-item">The current ${CATEGORY_LABELS[currentCategory].toLowerCase()} view covers <strong>${fmt(stateCount)}</strong> state/admin area(s), <strong>${fmt(countyCount)}</strong> county/counties, and <strong>${fmt(entityCount)}</strong> reporting entity/entities.</div>
        <div class="simple-insight-item">This view contains <strong>${fmt(indicatorCount)}</strong> indicator(s) with different units such as people, facilities, consultations, officials, km, or other reported values.</div>
        <div class="simple-insight-item">Value-based share insights are hidden until one indicator is selected, so different indicator units are not mixed together.</div>
      `;
      return;
    }

    if (totalValue <= 0) {
      container.innerHTML = `
        <div class="simple-insight-item">The selected indicator has no reported value for the current filters.</div>
        <div class="simple-insight-item">Selected data covers <strong>${fmt(countyCount)}</strong> county/counties and <strong>${fmt(entityCount)}</strong> reporting entity/entities.</div>
      `;
      return;
    }

    const selectedState = stateFilter.value && stateFilter.value !== "All" ? stateFilter.value : "";
    const selectedCounty = countyFilter.value && countyFilter.value !== "All" ? countyFilter.value : "";
    const selectedAgency = agencyFilter.value && agencyFilter.value !== "All" ? agencyFilter.value : "";
    const indicator = selectedIndicatorLabel();
    const items = [];

    items.push(`<div class="simple-insight-item">Selected indicator: <strong>${escapeHtml(indicator)}</strong> with total reported value of <span class="insight-blue">${fmt(totalValue)}</span> ${escapeHtml(label)}.</div>`);

    if (!selectedState && topState) {
      items.push(`<div class="simple-insight-item"><strong>${escapeHtml(topState[0])}</strong> accounts for <span class="insight-blue">${((topState[1] / totalValue) * 100).toFixed(1)}%</span> of the selected indicator's reported value.</div>`);
    }

    if (!selectedCounty && countyCount > 1 && topCounty) {
      items.push(`<div class="simple-insight-item">The highest county is <strong>${escapeHtml(topCounty[0])}</strong>, contributing <span class="insight-blue">${((topCounty[1] / totalValue) * 100).toFixed(1)}%</span> of the selected indicator's reported value.</div>`);
    } else if (selectedCounty) {
      items.push(`<div class="simple-insight-item">The selected county, <strong>${escapeHtml(selectedCounty)}</strong>, has a reported value of <span class="insight-blue">${fmt(totalValue)}</span> ${escapeHtml(label)} for this indicator.</div>`);
    }

    if (!selectedAgency && entityCount > 1 && topAgency) {
      items.push(`<div class="simple-insight-item">Leading reporting entity: <strong>${escapeHtml(topAgency[0])}</strong> with <span class="insight-blue">${((topAgency[1] / totalValue) * 100).toFixed(1)}%</span> of the selected indicator's reported value.</div>`);
    } else if (selectedAgency) {
      items.push(`<div class="simple-insight-item">The selected reporting entity is <strong>${escapeHtml(selectedAgency)}</strong>; contribution is shown only for this entity.</div>`);
    }

    items.push(`<div class="simple-insight-item">Selected data covers <strong>${fmt(countyCount)}</strong> county/counties and <strong>${fmt(entityCount)}</strong> reporting entity/entities.</div>`);

    container.innerHTML = items.join("");
  }

 function renderIndicatorTable(rows) {
  const tbody = document.getElementById("indicator-table");
  if (!tbody) return;

  const grouped = {};

  rows.forEach(r => {
    const key = `${r.supportType}||${r.indicator}`;

    if (!grouped[key]) {
      grouped[key] = {
        supportType: r.supportType,
        indicator: r.indicator,
        agencies: new Set(),
        reportedValue: 0
      };
    }

    grouped[key].agencies.add(r.agency);
    grouped[key].reportedValue += reportedValue(r);
  });

  const data = Object.values(grouped).sort((a, b) => b.reportedValue - a.reportedValue);

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No records match the selected filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(d => `
    <tr>
      <td>${escapeHtml(d.supportType)}</td>
      <td>
        <button type="button" class="indicator-link" data-indicator="${escapeHtml(d.indicator)}" style="background:none;border:0;color:#ffffff;font:inherit;font-weight:700;text-align:left;cursor:pointer;padding:0;line-height:1.45;">
          ${escapeHtml(d.indicator)}
        </button>
      </td>
      <td>${escapeHtml([...d.agencies].filter(a => a && a !== "Unknown").sort().join(", "))}</td>
      <td class="total-col">${fmt(d.reportedValue)}</td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".indicator-link").forEach(btn => {
    btn.addEventListener("click", () => {
      const selected = btn.dataset.indicator;
      if (!selected) return;
      indicatorFilter.value = selected;
      renderDashboard("indicator");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

  function showChartPlaceholder(id, message) {
    const el = document.getElementById(id);
    if (!el) return;
    if (typeof Plotly !== "undefined") Plotly.purge(id);
    el.innerHTML = `
      <div class="empty-chart" style="display:flex;align-items:center;justify-content:center;text-align:center;min-height:220px;padding:24px;line-height:1.5;">
        ${escapeHtml(message)}
      </div>
    `;
  }

  function setSectionDisplay(id, visible) {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? "" : "none";
  }

  function clearChart(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (typeof Plotly !== "undefined") Plotly.purge(id);
    el.innerHTML = "";
  }

  function renderControlledCharts(rowsForGeo) {
    const hasSingleIndicator = isSingleIndicatorSelected();
    const peopleBased = hasSingleIndicator && isPeopleBasedSelection(rowsForGeo);

    if (!hasSingleIndicator) {
      setSectionDisplay("geo-analysis-section", false);
      setSectionDisplay("population-agency-section", false);
      ["state-chart", "county-chart", "population-chart", "indicator-agency-chart"].forEach(clearChart);
      return;
    }

    setSectionDisplay("geo-analysis-section", true);

    renderBarChart("state-chart", groupSum(rowsForGeo, "state", true), 13, "#00AEEF");
    renderBarChart("county-chart", groupSum(rowsForGeo, "county", true), 12, "#00AEEF");

    const showPopulationGroups = shouldShowPopulationGroups(rowsForGeo);
    setSectionDisplay("population-agency-section", showPopulationGroups);

    if (showPopulationGroups) {
      renderPopulationChart(rowsForGeo);
    } else {
      clearChart("population-chart");
    }
  }

  function renderBarChart(id, obj, limit = 12, color = "#00AEEF") {
    const el = document.getElementById(id);
    if (!el || typeof Plotly === "undefined") return;

    const entries = Object.entries(obj)
      .filter(([name, value]) => name && name !== "Unknown" && Number(value) > 0)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, limit)
      .reverse();

    if (!entries.length) {
      Plotly.purge(id);
      el.innerHTML = `<div class="empty-chart">No data available</div>`;
      return;
    }

    const maxValue = Math.max(...entries.map(d => d[1]));

    Plotly.newPlot(id, [{
      type: "bar",
      orientation: "h",
      y: entries.map(d => d[0]),
      x: entries.map(d => d[1]),
      marker: {
        color,
        line: { color: "rgba(255,255,255,0.15)", width: 1 }
      },
      text: entries.map(d => fmt(d[1])),
      textposition: "outside",
      cliponaxis: false,
      hovertemplate: "<b>%{y}</b><br>Reported value: %{x:,}<extra></extra>"
    }], {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#8ba8c4", family: "Inter, sans-serif" },
      margin: { t: 18, r: maxValue > 999999 ? 105 : 80, b: 42, l: 230 },
      bargap: 0.32,
      xaxis: {
        gridcolor: "rgba(0,158,219,0.12)",
        zeroline: false,
        tickfont: { size: 11 },
        automargin: true
      },
      yaxis: {
        automargin: true,
        tickfont: { size: 11 }
      }
    }, {
      displayModeBar: false,
      responsive: true
    });
  }

  function renderPopulationChart(rows) {
    const el = document.getElementById("population-chart");
    if (!el || typeof Plotly === "undefined") return;

    const values = {
      IDPs: rows.reduce((s, r) => s + r.idps, 0),
      Returnees: rows.reduce((s, r) => s + r.returnees, 0),
      "Host community": rows.reduce((s, r) => s + r.hostCommunity, 0)
    };

    const entries = Object.entries(values).filter(([, v]) => v > 0);

    if (!entries.length) {
      Plotly.purge("population-chart");
      el.innerHTML = `<div class="empty-chart">No population group data available</div>`;
      return;
    }

    Plotly.newPlot("population-chart", [{
      type: "bar",
      x: entries.map(d => d[0]),
      y: entries.map(d => d[1]),
      marker: {
        color: "#00AEEF",
        line: { color: "rgba(255,255,255,0.15)", width: 1 }
      },
      text: entries.map(d => fmt(d[1])),
      textposition: "outside",
      hovertemplate: "<b>%{x}</b><br>%{y:,}<extra></extra>"
    }], {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#8ba8c4", family: "Inter, sans-serif" },
      margin: { t: 18, r: 35, b: 55, l: 70 },
      yaxis: {
        gridcolor: "rgba(0,158,219,0.12)",
        zeroline: false,
        tickfont: { size: 11 }
      },
      xaxis: {
        tickfont: { size: 11 }
      }
    }, {
      displayModeBar: false,
      responsive: true
    });
  }

  function renderIndicatorAgencyChart(rows) {
    const el = document.getElementById("indicator-agency-chart");
    if (!el || typeof Plotly === "undefined") return;

    const indicatorMap = {};
    const agencies = new Set();

    rows.forEach(r => {
      if (!indicatorMap[r.indicator]) {
        indicatorMap[r.indicator] = {
          indicator: r.indicator,
          total: 0,
          agencies: {}
        };
      }

      const value = reportedValue(r);

      indicatorMap[r.indicator].total += value;
      indicatorMap[r.indicator].agencies[r.agency] =
        (indicatorMap[r.indicator].agencies[r.agency] || 0) + value;

      agencies.add(r.agency);
    });

    const indicators = Object.values(indicatorMap)
      .filter(d => d.indicator !== "Unknown" && d.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);

    if (!indicators.length) {
      Plotly.purge("indicator-agency-chart");
      el.innerHTML = `<div class="empty-chart">No indicator data available</div>`;
      return;
    }

    const agencyList = [...agencies].filter(a => a !== "Unknown").sort();

    const palette = [
      "#00AEEF",
      "#2ED3B7",
      "#F472B6",
      "#A66CFF",
      "#F4C542",
      "#60A5FA",
      "#FB923C",
      "#34D399",
      "#C084FC"
    ];

    const yLabels = indicators.map(d => d.indicator).reverse();
    const reversedIndicators = indicators.slice().reverse();

    const traces = agencyList.map((agency, index) => ({
      type: "bar",
      orientation: "h",
      name: agency,
      y: yLabels,
      x: reversedIndicators.map(d => d.agencies[agency] || 0),
      marker: {
        color: palette[index % palette.length],
        line: { color: "rgba(255,255,255,0.16)", width: 1 }
      },
      hovertemplate:
        `<b>${agency}</b><br>` +
        `%{y}<br>` +
        `Reported value: %{x:,}` +
        `<extra></extra>`
    }));

    Plotly.newPlot("indicator-agency-chart", traces, {
      barmode: "stack",
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#8ba8c4", family: "Inter, sans-serif" },
      margin: { t: 22, r: 80, b: 70, l: 330 },
      bargap: 0.35,
      xaxis: {
        gridcolor: "rgba(0,158,219,0.13)",
        zeroline: false,
        tickfont: { size: 11 },
        automargin: true
      },
      yaxis: {
        automargin: true,
        tickfont: { size: 11 }
      },
      legend: {
        orientation: "h",
        x: 0,
        y: -0.22,
        font: { size: 12 },
        bgcolor: "rgba(0,0,0,0)"
      }
    }, {
      displayModeBar: false,
      responsive: true
    });
  }

  function getColor(value, minValue, maxValue) {
    if (!value || value <= 0) return "#3b3b3b";
    if (maxValue === minValue) return "#2f6fae";

    const ratio = (value - minValue) / (maxValue - minValue);

    if (ratio >= 0.85) return "#1f4e79";
    if (ratio >= 0.70) return "#2f6fae";
    if (ratio >= 0.55) return "#4f93c9";
    if (ratio >= 0.40) return "#76b5d8";
    if (ratio >= 0.25) return "#9ccbe6";
    if (ratio >= 0.10) return "#b9d8ec";
    return "#d6e8f5";
  }

  async function initDurableMap() {
    if (mapInitialized || typeof L === "undefined") return;

    const mapEl = document.getElementById("durable-map");
    if (!mapEl) return;

    durableMap = L.map("durable-map", {
      zoomControl: true,
      attributionControl: false
    }).setView([7.6, 30.2], 6);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 12
    }).addTo(durableMap);

    L.control.attribution({ prefix: false })
      .addAttribution("&copy; OpenStreetMap &copy; CARTO")
      .addTo(durableMap);

    try {
      const res = await fetch("data/SouthSudan.json?v=20260503");
      if (!res.ok) throw new Error("Could not load data/SouthSudan.json");

      countyGeoJson = await res.json();
      mapInitialized = true;

      setTimeout(() => durableMap.invalidateSize(), 150);
    } catch (err) {
      showWarning("Map boundary file was not loaded. Please place SouthSudan.json inside the data folder.");
      console.error(err);
    }
  }

  function styleCounty(feature, countyData, minValue, maxValue, hasSingleIndicator) {
    const countyName = feature.properties.ADM2_EN || "";
    const d = countyData[normName(countyName)];
    const hasData = !!d;
    const value = d ? d.current : 0;

    if (!hasSingleIndicator) {
      return {
        fillColor: hasData ? "#8fc7e8" : "#3b3b3b",
        weight: hasData ? 1.25 : 0.7,
        opacity: 1,
        color: hasData ? "rgba(230,245,255,0.90)" : "rgba(160,160,160,0.30)",
        fillOpacity: hasData ? 0.78 : 0.38
      };
    }

    return {
      fillColor: getColor(value, minValue, maxValue),
      weight: 0.9,
      opacity: 1,
      color: value > 0 ? "rgba(220,235,250,0.75)" : "rgba(160,160,160,0.35)",
      fillOpacity: value > 0 ? 0.85 : 0.42
    };
  }

  function createPopupHtml(countyName, stateName, d) {
    const hasSingleIndicator = isSingleIndicatorSelected();
    const peopleBased = hasSingleIndicator && isPeopleBasedSelection([]);

    if (!d) {
      return `
        <div class="leaflet-popup-custom">
          <div class="popup-title">${escapeHtml(countyName)}</div>
          <div class="popup-subtitle">${escapeHtml(stateName)}</div>
          <div class="popup-row"><span>Status</span><strong>No data</strong></div>
        </div>
      `;
    }

    const indicatorsSummary = [...d.indicators]
      .filter(Boolean)
      .sort()
      .map(i => `<div class="popup-bullet">• ${escapeHtml(i)}</div>`)
      .join("");

    const agenciesSummary = [...d.agencies].filter(Boolean).sort().join(", ");

    if (!hasSingleIndicator) {
      return `
        <div class="leaflet-popup-custom">
          <div class="popup-title">${escapeHtml(countyName)}</div>
          <div class="popup-subtitle">${escapeHtml(stateName)}</div>
          <div class="popup-row"><span>Coverage status</span><strong>Reported data available</strong></div>
          <div class="popup-row"><span>Reporting entities</span><strong>${fmt(d.agencies.size)}</strong></div>
          <div class="popup-row"><span>Indicators reported</span><strong>${fmt(d.indicators.size)}</strong></div>
          <div class="popup-section">
            <div class="popup-section-title">Reporting Agencies</div>
            <div class="popup-text">${escapeHtml(agenciesSummary || "—")}</div>
          </div>
          <div class="popup-section">
            <div class="popup-section-title">Indicators</div>
            ${indicatorsSummary || `<div class="popup-text">—</div>`}
          </div>
        </div>
      `;
    }

    const peopleRows = peopleBased ? `
        <div class="popup-row"><span>Male</span><strong>${fmt(d.male)}</strong></div>
        <div class="popup-row"><span>Female</span><strong>${fmt(d.female)}</strong></div>
        <div class="popup-row"><span>IDPs</span><strong>${fmt(d.idps)}</strong></div>
        <div class="popup-row"><span>Returnees</span><strong>${fmt(d.returnees)}</strong></div>
        <div class="popup-row"><span>Host community</span><strong>${fmt(d.hostCommunity)}</strong></div>
    ` : "";

    return `
      <div class="leaflet-popup-custom">
        <div class="popup-title">${escapeHtml(countyName)}</div>
        <div class="popup-subtitle">${escapeHtml(stateName)}</div>
        <div class="popup-row"><span>Reported value</span><strong>${fmt(d.current)}</strong></div>
        ${peopleRows}
        <div class="popup-section">
          <div class="popup-section-title">Reporting Agencies</div>
          <div class="popup-text">${escapeHtml(agenciesSummary || "—")}</div>
        </div>
        <div class="popup-section">
          <div class="popup-section-title">Indicator</div>
          ${indicatorsSummary || `<div class="popup-text">—</div>`}
        </div>
      </div>
    `;
  }

  function autoZoomMapToFilteredData(countyData, layerGroup) {
    if (!durableMap || !layerGroup) return;

    const filteredCountyNames = new Set(
      Object.values(countyData)
        .map(d => normName(d.county))
    );

    const matchingLayers = [];

    layerGroup.eachLayer(layer => {
      const countyName = layer.feature?.properties?.ADM2_EN || "";
      if (filteredCountyNames.has(normName(countyName))) {
        matchingLayers.push(layer);
      }
    });

    try {
      if (matchingLayers.length > 0) {
        const bounds = L.featureGroup(matchingLayers).getBounds();
        durableMap.fitBounds(bounds, {
          padding: [45, 45],
          maxZoom: matchingLayers.length === 1 ? 8.8 : 7.6,
          animate: true,
          duration: 1.2
        });
      } else {
        durableMap.fitBounds(layerGroup.getBounds(), {
          padding: [25, 25],
          maxZoom: 6.2,
          animate: true,
          duration: 1.2
        });
      }

      setTimeout(() => durableMap.invalidateSize(), 150);
    } catch (e) {
      durableMap.setView([7.6, 30.2], 6);
    }
  }

  function renderDurableMap(rows) {
    if (!durableMap || !countyGeoJson) return;

    const hasSingleIndicator = isSingleIndicatorSelected();
    const countyData = groupCountyFull(rows);
    const values = Object.values(countyData).map(d => d.current).filter(v => v > 0);

    const minValue = values.length ? Math.min(...values) : 0;
    const maxValue = values.length ? Math.max(...values) : 0;

    setText("map-section-title", hasSingleIndicator ? "Geographical Coverage by Selected Indicator Reported Value" : "Geographical Coverage");
    setText("map-legend-note", hasSingleIndicator
      ? "County shading uses the selected indicator reported value."
      : "County shading shows coverage only. Select one indicator to view comparable reported values.");

    if (countyLayer) {
      durableMap.removeLayer(countyLayer);
    }

    countyLayer = L.geoJSON(countyGeoJson, {
      style: feature => styleCounty(feature, countyData, minValue, maxValue, hasSingleIndicator),
      onEachFeature: (feature, layer) => {
        const countyName = feature.properties.ADM2_EN || "Unknown";
        const stateName = feature.properties.ADM1_EN || "Unknown";
        const d = countyData[normName(countyName)];

        layer.bindPopup(createPopupHtml(countyName, stateName, d), {
          maxWidth: 360,
          minWidth: 280,
          className: "food-popup"
        });

        layer.on({
          mouseover: e => {
            e.target.setStyle({
              weight: 2,
              color: "#ffffff",
              fillOpacity: 0.95
            });
            e.target.bringToFront();
          },
          mouseout: e => {
            countyLayer.resetStyle(e.target);
          }
        });
      }
    }).addTo(durableMap);

    autoZoomMapToFilteredData(countyData, countyLayer);
    renderMapSummary(countyData);
  }

  function renderMapSummary(countyData) {
    const counties = Object.values(countyData);
    const hasSingleIndicator = isSingleIndicatorSelected();
    const peopleBased = hasSingleIndicator && isPeopleBasedSelection([]);

    setText("map-counties", fmt(counties.length));

    if (!hasSingleIndicator) {
      const entityCount = new Set();
      const indicatorCount = new Set();

      counties.forEach(d => {
        d.agencies.forEach(a => { if (a && a !== "Unknown") entityCount.add(a); });
        d.indicators.forEach(i => { if (i && i !== "Unknown") indicatorCount.add(i); });
      });

      setText("map-value-label", "Reporting Entities");
      setText("map-beneficiaries", fmt(entityCount.size));
      setText("map-third-label", "Indicators");
      setText("map-male", fmt(indicatorCount.size));
      setText("map-fourth-label", "Mode");
      setText("map-female", "Coverage");
    } else {
      setText("map-value-label", "Reported Value");
      setText("map-beneficiaries", fmt(counties.reduce((s, d) => s + d.current, 0)));

      if (peopleBased) {
        setText("map-third-label", "Male");
        setText("map-fourth-label", "Female");
        setText("map-male", fmt(counties.reduce((s, d) => s + d.male, 0)));
        setText("map-female", fmt(counties.reduce((s, d) => s + d.female, 0)));
      } else {
        setText("map-third-label", "Male");
        setText("map-fourth-label", "Female");
        setText("map-male", "—");
        setText("map-female", "—");
      }
    }

    const topEl = document.getElementById("map-top-counties");
    if (!topEl) return;

    if (!hasSingleIndicator) {
      topEl.innerHTML = `<div class="top-empty">Coverage view only. Select one indicator to view top counties by comparable reported value.</div>`;
      return;
    }

    const top = counties
      .filter(d => d.current > 0)
      .sort((a, b) => b.current - a.current)
      .slice(0, 5);

    topEl.innerHTML = top.length
      ? top.map((d, i) => `
          <div class="top-row">
            <div class="top-rank">${i + 1}</div>
            <div class="top-name">${escapeHtml(d.county)}</div>
            <div class="top-value">${fmt(d.current)}</div>
          </div>
        `).join("")
      : `<div class="top-empty">No county data available</div>`;
  }

  async function renderDashboard(changedFilter = "") {
    refreshDependentFilters(changedFilter);

    const rows = getFilteredRecords();
    const rowsForGeo = geoRows(rows);

    renderKpis(rows);
    renderSimpleInsights(rows, rowsForGeo);
    renderIndicatorTable(rows);
    renderControlledCharts(rowsForGeo);

    if (!mapInitialized) {
      await initDurableMap();
    }

    renderDurableMap(rowsForGeo);
  }

  function initializeFilters() {
    setOptions(indicatorFilter, uniqueSorted(categoryRecords().map(r => r.indicator)));
    setOptions(agencyFilter, uniqueSorted(categoryRecords().map(r => r.agency)));
    setOptions(stateFilter, uniqueSorted(geoRows(categoryRecords()).map(r => r.state)));
    setOptions(countyFilter, uniqueSorted(geoRows(categoryRecords()).map(r => r.county)));

    indicatorFilter.addEventListener("change", () => renderDashboard("indicator"));
    agencyFilter.addEventListener("change", () => renderDashboard("agency"));
    stateFilter.addEventListener("change", () => renderDashboard("state"));
    countyFilter.addEventListener("change", () => renderDashboard("county"));

    resetBtn.addEventListener("click", () => {
      indicatorFilter.value = "All";
      agencyFilter.value = "All";
      stateFilter.value = "All";
      countyFilter.value = "All";
      renderDashboard();
    });

    document.querySelectorAll(".sector-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        currentCategory = btn.dataset.category;
        document.querySelectorAll(".sector-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        renderDashboard("category");
      });
    });
  }

  function showWarning(message) {
    if (!warningBox) return;
    warningBox.textContent = message;
    warningBox.style.display = "block";
  }

  window.toggleDurableIndicatorTable = function () {
    const panel = document.getElementById("indicator-table-panel");
    const btn = document.getElementById("indicator-table-toggle");
    if (!panel || !btn) return;

    const isHidden = panel.style.display === "none" || panel.style.display === "";
    panel.style.display = isHidden ? "block" : "none";
    btn.textContent = isHidden ? "Hide Detailed Table" : "Show Detailed Table";
  };

  initializeFilters();
  renderDashboard();

  window.addEventListener("resize", () => {
    ["state-chart", "county-chart", "population-chart"].forEach(id => {
      const el = document.getElementById(id);
      if (el && typeof Plotly !== "undefined") Plotly.Plots.resize(el);
    });

    if (durableMap) {
      setTimeout(() => durableMap.invalidateSize(), 150);
    }
  });
});
