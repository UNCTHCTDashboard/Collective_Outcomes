document.addEventListener("DOMContentLoaded", () => {
  const warningBox = document.getElementById("data-warning");

  if (
    typeof CO_DATA === "undefined" ||
    !CO_DATA.basicServices ||
    !Array.isArray(CO_DATA.basicServices.records)
  ) {
    showWarning("Basic Services data was not loaded. Please make sure CO_DATA.basicServices.records exists in js/data.js.");
    return;
  }

  let currentSector = "Education";

  const ADMIN_AREAS = CO_DATA.basicServices.adminAreas || [
    "Abyei Region",
    "Pibor Administrative Area",
    "Ruweng Administrative Area",
    "Abyei",
    "Pibor",
    "Ruweng"
  ];

  const AGENCY_COLORS = {
    "WFP": "#FFD166",
    "FAO": "#00AEEF",
    "NGOs": "#2ED3B7",
    "NGO": "#2ED3B7",
    "UNICEF": "#4FC3F7",
    "UNFPA": "#F8BBD0",
    "UNESCO": "#C4B5FD",
    "WHO": "#86EFAC",
    "IOM": "#FDBA74",
    "UNHCR": "#67E8F9",
    "UNICEF/UNFPA/WHO": "#D8B4FE",
    "UNDP": "#CBD5E1"
  };

  const records = CO_DATA.basicServices.records.map(normalizeRecord);

  const indicatorFilter = document.getElementById("indicator-filter");
  const agencyFilter = document.getElementById("agency-filter");
  const stateFilter = document.getElementById("state-filter");
  const countyFilter = document.getElementById("county-filter");
  const resetBtn = document.getElementById("reset-filters");

  const openMapSelectorBtn = document.getElementById("open-map-selector");
  const closeMapSelectorBtn = document.getElementById("close-map-selector");
  const mapDrawerOverlay = document.getElementById("map-drawer-overlay");
  const mapSelectorDrawer = document.getElementById("map-selector-drawer");
  const mapSelectorSearch = document.getElementById("map-selector-search");
  const mapSelectorType = document.getElementById("map-selector-type");
  const mapSelectorSort = document.getElementById("map-selector-sort");
  const mapSelectorList = document.getElementById("map-selector-list");
  const mapSelectorCount = document.getElementById("map-selector-count");
  const clearMapSelectionBtn = document.getElementById("clear-map-selection");
  const applyMapSelectionBtn = document.getElementById("apply-map-selection");
  const activeMapFilterPill = document.getElementById("active-map-filter-pill");

  const viewMapBtn = document.getElementById("view-map-btn");
  const viewAgencyRankingBtn = document.getElementById("view-agency-ranking-btn");
  const basicMapViewPanel = document.getElementById("basic-map-view-panel");
  const basicAgencyRankingPanel = document.getElementById("basic-agency-ranking-panel");

  let selectedMapStates = new Set();
  let selectedMapCounties = new Set();
  let pendingMapStates = new Set();
  let pendingMapCounties = new Set();

  let basicMap = null;
  let countyLayer = null;
  let countyGeoJson = null;
  let mapInitialized = false;
  let activeVisualView = "map";

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
      sector: clean(r.sector || r.subCategory || r.category),
      indicator: clean(r.indicator),
      agency: clean(r.agency),
      state: clean(r.state),
      county: clean(r.county),
      period: clean(r.period),
      current: toNumber(r.current),
      target: toNumber(r.target),
      male: toNumber(r.male),
      female: toNumber(r.female)
    };
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, m => ({
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
    return [...new Set(arr.filter(v => v && v !== "Unknown"))].sort((a, b) => a.localeCompare(b));
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

  function setDisplay(id, show) {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? "" : "none";
  }

  function setOptions(select, values, allLabel = "All") {
    if (!select) return;
    const current = select.value || "All";

    select.innerHTML =
      `<option value="All">${allLabel}</option>` +
      values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");

    select.value = [...select.options].some(o => o.value === current) ? current : "All";
  }

  function sectorRecords() {
    return records.filter(r => normText(r.sector) === normText(currentSector));
  }

  function isTotalAncRow(r) {
    return currentSector === "Health" && normText(r.indicator) === "total % antenatal care coverage";
  }

  function isAncCoverageRow(r) {
    return currentSector === "Health" && normText(r.indicator) === "antenatal care coverage";
  }

  function selectedIsAncCoverage() {
    return currentSector === "Health" && normText(indicatorFilter.value) === "antenatal care coverage";
  }

  function selectedIsHealthFacilities() {
    return currentSector === "Health" && normText(indicatorFilter.value) === "health facilities delivering the full essential health services package";
  }

  function selectedIsHealthEmergencies() {
    return currentSector === "Health" && normText(indicatorFilter.value).includes("public health emergencies");
  }

  function isCombinedAncAgency(r) {
    return currentSector === "Health" && normText(r.agency) === "unicef/unfpa/who";
  }

  function metricLabel() {
    if (selectedIsHealthFacilities()) return "Health Facilities";
    if (selectedIsHealthEmergencies()) return "Health Emergencies";
    if (selectedIsAncCoverage()) return "Antenatal Coverage";
    return "Beneficiaries";
  }

  function metricSubLabel() {
    if (selectedIsHealthFacilities()) return "health facilities";
    if (selectedIsHealthEmergencies()) return "health emergencies";
    if (selectedIsAncCoverage()) return "reported female";
    return "people reached / served";
  }

  function getAgencyColor(agency, index = 0) {
    const fallback = ["#00AEEF", "#2ED3B7", "#F472B6", "#A66CFF", "#F4C542", "#60A5FA", "#FB923C"];
    return AGENCY_COLORS[String(agency || "").trim()] || fallback[index % fallback.length];
  }

  function isGeoFilterActive() {
    return (
      (stateFilter.value && stateFilter.value !== "All") ||
      (countyFilter.value && countyFilter.value !== "All")
    );
  }

  function isGeoRow(r) {
    const state = normText(r.state);
    const county = normText(r.county);
    return !(state === "country wide" || state === "countrywide" || county === "nationwide" || isTotalAncRow(r));
  }

  function geoRows(rows) {
    return rows.filter(isGeoRow);
  }

  function agencyCountRows(rows) {
    return rows.filter(r => !isCombinedAncAgency(r));
  }

  function progressRows(rows) {
    if (currentSector !== "Health") return rows;

    const selectedIndicator = indicatorFilter.value || "All";
    if (selectedIndicator !== "All") return rows;

    const geoActive = isGeoFilterActive();
    return rows.filter(r => geoActive ? !isTotalAncRow(r) : !isAncCoverageRow(r));
  }

  function getBeneficiaryValue(r) {
    if (isAncCoverageRow(r)) return Number(r.female || 0);
    return Number(r.current || 0);
  }

  function getHealthBeneficiaryTotal(rows) {
    const fromNumber = rows
      .filter(r => normText(r.indicator) === "people accessing health services")
      .reduce((s, r) => s + Number(r.current || 0), 0);

    const fromFemale = rows
      .filter(r => normText(r.indicator) === "total % antenatal care coverage")
      .reduce((s, r) => s + Number(r.female || 0), 0);

    if (fromFemale === 0 && isGeoFilterActive()) {
      const geoAnc = geoRows(rows)
        .filter(r => isAncCoverageRow(r))
        .reduce((s, r) => s + Number(r.female || 0), 0);

      return fromNumber + geoAnc;
    }

    return fromNumber + fromFemale;
  }

  function getFilteredRecords() {
    const indicator = indicatorFilter.value || "All";
    const agency = agencyFilter.value || "All";
    const state = stateFilter.value || "All";
    const county = countyFilter.value || "All";

    return sectorRecords().filter(r => {
      const matchesTopFilters =
        (indicator === "All" || r.indicator === indicator) &&
        (agency === "All" || r.agency === agency) &&
        (state === "All" || r.state === state) &&
        (county === "All" || r.county === county);

      const hasMapSelection = selectedMapStates.size > 0 || selectedMapCounties.size > 0;
      const matchesMapSelection = !hasMapSelection ||
        selectedMapStates.has(r.state) ||
        selectedMapCounties.has(r.county);

      return matchesTopFilters && matchesMapSelection;
    });
  }
function refreshDependentFilters(changedFilter = "") {

  let filtered = sectorRecords();

  // Reset logic
  if (changedFilter === "sector") {
    indicatorFilter.value = "All";
    agencyFilter.value = "All";
    stateFilter.value = "All";
    countyFilter.value = "All";
  }

  if (changedFilter === "indicator" || changedFilter === "agency") {
    stateFilter.value = "All";
    countyFilter.value = "All";
  }

  if (changedFilter === "state") {
    countyFilter.value = "All";
  }

  // ---------------------------
  // 1️⃣ Indicator (based on sector only)
  // ---------------------------
  const indicatorOptions = filtered
    .filter(r => !(currentSector === "Health" && isTotalAncRow(r)))
    .map(r => r.indicator);

  setOptions(indicatorFilter, uniqueSorted(indicatorOptions));

  // ---------------------------
  // 2️⃣ Apply Indicator filter
  // ---------------------------
  if (indicatorFilter.value !== "All") {
    filtered = filtered.filter(r => r.indicator === indicatorFilter.value);
  }

  // ---------------------------
  // 3️⃣ Agency (based on indicator)
  // ---------------------------
  let agencyBase = filtered;

  if (currentSector === "Health" && indicatorFilter.value === "All") {
    agencyBase = agencyCountRows(geoRows(agencyBase));
  }

  setOptions(agencyFilter, uniqueSorted(agencyBase.map(r => r.agency)));

  // ---------------------------
  // 4️⃣ Apply Agency filter
  // ---------------------------
  if (agencyFilter.value !== "All") {
    filtered = filtered.filter(r => r.agency === agencyFilter.value);
  }

  // ---------------------------
  // 5️⃣ State (based on indicator + agency)
  // ---------------------------
  const stateBase = geoRows(filtered);
  setOptions(stateFilter, uniqueSorted(stateBase.map(r => r.state)));

  // ---------------------------
  // 6️⃣ Apply State filter
  // ---------------------------
  if (stateFilter.value !== "All") {
    filtered = filtered.filter(r => r.state === stateFilter.value);
  }

  // ---------------------------
  // 7️⃣ County (final level)
  // ---------------------------
  const countyBase = geoRows(filtered);
  setOptions(countyFilter, uniqueSorted(countyBase.map(r => r.county)));
}

  function groupSum(rows, field) {
    return rows.reduce((out, r) => {
      const key = r[field] || "Unknown";
      out[key] = (out[key] || 0) + getBeneficiaryValue(r);
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
          target: Number(r.target || 0),
          count: 0,
          isCoverage: isAncCoverageRow(r) || isTotalAncRow(r)
        };
      }

      grouped[r.indicator].agencies.add(r.agency);
      grouped[r.indicator].current += Number(r.current || 0);

      if (grouped[r.indicator].isCoverage) grouped[r.indicator].count += 1;
      if (!grouped[r.indicator].target && r.target) grouped[r.indicator].target = Number(r.target || 0);
    });

    return Object.values(grouped)
      .map(d => {
        if (d.isCoverage && d.count > 1) d.current = d.current / d.count;
        return d;
      })
      .sort((a, b) => b.current - a.current);
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
          female: 0
        };
      }

      grouped[key].agencies.add(r.agency);
      grouped[key].indicators.add(r.indicator);
      grouped[key].current += getBeneficiaryValue(r);
      grouped[key].male += r.male;
      grouped[key].female += r.female;
    });

    return grouped;
  }

  function renderKpis(rows) {
    const rowsForGeo = geoRows(rows);
    const rowsForAgencyCount = selectedIsAncCoverage() ? rowsForGeo : agencyCountRows(rowsForGeo);

    const states = new Set();
    const adminAreas = new Set();
    const counties = new Set();
    const agencies = new Set();

    rowsForGeo.forEach(r => {
      if (ADMIN_AREAS.includes(r.state)) adminAreas.add(r.state);
      else if (r.state !== "Unknown") states.add(r.state);

      if (r.county !== "Unknown") counties.add(r.county);
    });

    rowsForAgencyCount.forEach(r => {
      if (r.agency !== "Unknown") agencies.add(r.agency);
    });

    const totalValue =
      selectedIsHealthFacilities() || selectedIsHealthEmergencies()
        ? rowsForGeo.reduce((s, r) => s + Number(r.current || 0), 0)
        : currentSector === "Health"
          ? getHealthBeneficiaryTotal(rows)
          : rowsForGeo.reduce((s, r) => s + getBeneficiaryValue(r), 0);

    setText("snapshot-title", `${currentSector} Snapshot`);
    setText("kpi-states", fmt(states.size));
    setText("kpi-admin-areas", fmt(adminAreas.size));
    setText("kpi-counties", fmt(counties.size));
    setText("kpi-agencies", fmt(agencies.size));
    setText("kpi-current", fmt(totalValue));
    setText("kpi-current-label", metricLabel());
    setText("kpi-current-sub", metricSubLabel());

    const currentCard = document.getElementById("kpi-current")?.closest(".kpi-card");
    const maleCard = document.getElementById("kpi-male")?.closest(".kpi-card");
    const femaleCard = document.getElementById("kpi-female")?.closest(".kpi-card");

    if (currentCard) currentCard.style.display = selectedIsAncCoverage() ? "none" : "";
    if (maleCard) maleCard.style.display = (selectedIsHealthFacilities() || selectedIsAncCoverage()) ? "none" : "";
    if (femaleCard) femaleCard.style.display = selectedIsHealthFacilities() ? "none" : "";

    setText("kpi-male", fmt(rowsForGeo.reduce((s, r) => s + r.male, 0)));
    setText("kpi-female", fmt(rowsForGeo.reduce((s, r) => s + r.female, 0)));
  }

  function renderTable(rows) {
    const tbody = document.getElementById("indicator-table");
    if (!tbody) return;

    const grouped = groupIndicators(rows);

    if (!grouped.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No records match the selected filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = grouped.map(d => {
      const achieved = d.target ? `${((d.current / d.target) * 100).toFixed(1)}%` : "—";

      return `
        <tr>
          <td>${escapeHtml(currentSector)}</td>
          <td>${escapeHtml(d.indicator)}</td>
          <td>${escapeHtml([...d.agencies].sort().join(", "))}</td>
          <td class="total-col">${d.isCoverage ? d.current.toFixed(1) : fmt(d.current)}</td>
          <td>${fmt(d.target)}</td>
          <td class="total-col">${achieved}</td>
        </tr>
      `;
    }).join("");
  }

  function renderStackedAgencyBarChart(id, rows, groupField, limit = 12) {
    const el = document.getElementById(id);
    if (!el || typeof Plotly === "undefined") return;

    const grouped = {};
    const agencies = new Set();

    rows.forEach(r => {
      const groupName = r[groupField] || "Unknown";
      const agency = r.agency || "Unknown";
      const value = getBeneficiaryValue(r);

      if (!groupName || groupName === "Unknown" || !agency || agency === "Unknown" || value <= 0) return;

      if (!grouped[groupName]) grouped[groupName] = { name: groupName, total: 0, agencies: {} };

      grouped[groupName].total += value;
      grouped[groupName].agencies[agency] = (grouped[groupName].agencies[agency] || 0) + value;
      agencies.add(agency);
    });

    const groups = Object.values(grouped)
      .filter(d => d.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, limit)
      .reverse();

    if (!groups.length) {
      Plotly.purge(id);
      el.innerHTML = `<div class="empty-chart">No data available</div>`;
      return;
    }

    const agencyList = [...agencies].sort();

    const traces = agencyList.map((agency, index) => ({
      type: "bar",
      orientation: "h",
      name: agency,
      y: groups.map(d => d.name),
      x: groups.map(d => d.agencies[agency] || 0),
      marker: {
        color: getAgencyColor(agency, index),
        line: { color: "rgba(255,255,255,0.15)", width: 1 }
      },
      hovertemplate: `<b>${agency}</b><br>%{y}<br>${metricLabel()}: %{x:,}<extra></extra>`
    }));

    const totals = {
      type: "scatter",
      mode: "text",
      showlegend: false,
      y: groups.map(d => d.name),
      x: groups.map(d => d.total),
      text: groups.map(d => fmt(d.total)),
      textposition: "middle right",
      textfont: { color: "#B8D9F7", size: 12, family: "Inter, sans-serif" },
      hoverinfo: "skip",
      cliponaxis: false
    };

    const maxValue = Math.max(...groups.map(d => d.total));

    Plotly.newPlot(id, [...traces, totals], {
      barmode: "stack",
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#8ba8c4", family: "Inter, sans-serif" },
      margin: { t: 18, r: maxValue > 999999 ? 120 : 90, b: 70, l: 210 },
      bargap: 0.32,
      xaxis: { gridcolor: "rgba(0,158,219,0.12)", zeroline: false, tickfont: { size: 11 }, automargin: true },
      yaxis: { automargin: true, tickfont: { size: 11 } },
      legend: { orientation: "h", x: 0, y: -0.22, font: { size: 12 }, bgcolor: "rgba(0,0,0,0)" }
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
      const indicator = r.indicator || "Unknown";
      const agency = r.agency || "Unknown";

      if (!indicatorMap[indicator]) {
        indicatorMap[indicator] = {
          indicator,
          target: Number(r.target || 0),
          total: 0,
          agencies: {},
          isCoverage: isAncCoverageRow(r) || isTotalAncRow(r),
          count: 0
        };
      }

      indicatorMap[indicator].total += Number(r.current || 0);
      indicatorMap[indicator].agencies[agency] =
        (indicatorMap[indicator].agencies[agency] || 0) + Number(r.current || 0);

      if (indicatorMap[indicator].isCoverage) indicatorMap[indicator].count += 1;
      agencies.add(agency);

      if (!indicatorMap[indicator].target && r.target) {
        indicatorMap[indicator].target = Number(r.target || 0);
      }
    });

    const indicators = Object.values(indicatorMap)
      .map(d => {
        if (d.isCoverage && d.count > 1) {
          d.total = d.total / d.count;
          Object.keys(d.agencies).forEach(a => {
            d.agencies[a] = d.agencies[a] / d.count;
          });
        }
        return d;
      })
      .filter(d => d.indicator !== "Unknown" && d.total > 0 && d.target > 0)
      .sort((a, b) => (b.total / b.target) - (a.total / a.target));

    if (!indicators.length) {
      Plotly.purge("indicator-agency-chart");
      el.innerHTML = `<div class="empty-chart">No indicator achievement data available</div>`;
      return;
    }

    const agencyList = [...agencies].filter(a => a !== "Unknown").sort();
    const yLabels = indicators.map(d => d.indicator).reverse();
    const reversedIndicators = indicators.slice().reverse();

    const traces = agencyList.map((agency, index) => ({
      type: "bar",
      orientation: "h",
      name: agency,
      y: yLabels,
      x: reversedIndicators.map(d => {
        const value = d.agencies[agency] || 0;
        return d.target ? (value / d.target) * 100 : 0;
      }),
      customdata: reversedIndicators.map(d => {
        const value = d.agencies[agency] || 0;
        return [
          value,
          d.target,
          d.target ? (value / d.target) * 100 : 0
        ];
      }),
      marker: {
        color: getAgencyColor(agency, index),
        line: { color: "rgba(255,255,255,0.16)", width: 1 }
      },
      hovertemplate:
        `<b>${agency}</b><br>` +
        `%{y}<br>` +
        `Contribution: %{customdata[0]:,.1f}<br>` +
        `Target: %{customdata[1]:,}<br>` +
        `Contribution to target: %{customdata[2]:.1f}%` +
        `<extra></extra>`
    }));

    const totalLabels = {
      type: "scatter",
      mode: "text",
      showlegend: false,
      y: yLabels,
      x: reversedIndicators.map(d => d.target ? (d.total / d.target) * 100 : 0),
      text: reversedIndicators.map(d => d.target ? `${((d.total / d.target) * 100).toFixed(1)}%` : "—"),
      textposition: "middle right",
      textfont: { color: "#B8D9F7", size: 12, family: "Inter, sans-serif" },
      hoverinfo: "skip",
      cliponaxis: false
    };

    const maxAchieved = Math.max(
      120,
      ...reversedIndicators.map(d => d.target ? (d.total / d.target) * 100 : 0)
    );

    Plotly.newPlot("indicator-agency-chart", [...traces, totalLabels], {
      barmode: "stack",
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#8ba8c4", family: "Inter, sans-serif" },
      margin: { t: 22, r: 150, b: 70, l: 330 },
      bargap: 0.35,
      xaxis: {
        range: [0, maxAchieved * 1.12],
        ticksuffix: "%",
        gridcolor: "rgba(0,158,219,0.13)",
        zeroline: false,
        tickfont: { size: 11 },
        automargin: true
      },
      yaxis: {
        automargin: true,
        tickfont: { size: 11 }
      },
      shapes: [{
        type: "line",
        x0: 100,
        x1: 100,
        y0: -0.5,
        y1: yLabels.length - 0.5,
        xref: "x",
        yref: "y",
        line: {
          color: "rgba(255,255,255,0.75)",
          width: 2,
          dash: "dot"
        }
      }],
      annotations: [{
        x: 100,
        y: yLabels.length - 0.35,
        xref: "x",
        yref: "y",
        text: "100% target",
        showarrow: false,
        font: { color: "#ffffff", size: 11 },
        xanchor: "left",
        yanchor: "bottom"
      }],
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

  async function initBasicMap() {
    if (mapInitialized || typeof L === "undefined") return;

    const mapEl = document.getElementById("basic-map");
    if (!mapEl) return;

    basicMap = L.map("basic-map", {
      zoomControl: true,
      attributionControl: false
    }).setView([7.6, 30.2], 6);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 12
    }).addTo(basicMap);

    L.control.attribution({ prefix: false })
      .addAttribution("&copy; OpenStreetMap &copy; CARTO")
      .addTo(basicMap);

    try {
      const res = await fetch("data/SouthSudan.json?v=20260503");
      if (!res.ok) throw new Error("Could not load data/SouthSudan.json");

      countyGeoJson = await res.json();
      mapInitialized = true;

      setTimeout(() => basicMap.invalidateSize(), 150);
    } catch (err) {
      showWarning("Map boundary file was not loaded. Please place SouthSudan.json inside the data folder.");
      console.error(err);
    }
  }

  function styleCounty(feature, countyData, minValue, maxValue) {
    const countyName = feature.properties.ADM2_EN || "";
    const stateName = feature.properties.ADM1_EN || "";
    const d = countyData[normName(countyName)];
    const value = d ? d.current : 0;
    const isSelected = selectedMapStates.has(stateName) || selectedMapCounties.has(countyName);

    return {
      fillColor: getColor(value, minValue, maxValue),
      weight: isSelected ? 2.4 : 0.9,
      opacity: 1,
      color: isSelected ? "#ffffff" : (value > 0 ? "rgba(220,235,250,0.75)" : "rgba(160,160,160,0.35)"),
      fillOpacity: value > 0 ? 0.85 : 0.42
    };
  }

  function createPopupHtml(countyName, stateName, d) {
    if (!d) {
      return `
        <div class="leaflet-popup-custom">
          <div class="popup-title">${escapeHtml(countyName)}</div>
          <div class="popup-subtitle">${escapeHtml(stateName)}</div>
          <div class="popup-row"><span>${metricLabel()}</span><strong>No data</strong></div>
        </div>
      `;
    }

    const indicatorsSummary = [...d.indicators]
      .filter(Boolean)
      .sort()
      .map(i => `<div class="popup-bullet">• ${escapeHtml(i)}</div>`)
      .join("");

    const agenciesSummary = [...d.agencies].filter(Boolean).sort().join(", ");

    let metricRow = "";
    if (!selectedIsAncCoverage()) {
      metricRow = `<div class="popup-row"><span>${metricLabel()}</span><strong>${fmt(d.current)}</strong></div>`;
    }

    let genderPopupRows = "";
    if (selectedIsAncCoverage()) {
      genderPopupRows = `
        <div class="popup-row"><span>Female</span><strong>${fmt(d.female)}</strong></div>`;
    } else if (!selectedIsHealthFacilities()) {
      genderPopupRows = `
        <div class="popup-row"><span>Male</span><strong>${fmt(d.male)}</strong></div>
        <div class="popup-row"><span>Female</span><strong>${fmt(d.female)}</strong></div>`;
    }

    return `
      <div class="leaflet-popup-custom">
        <div class="popup-title">${escapeHtml(countyName)}</div>
        <div class="popup-subtitle">${escapeHtml(stateName)}</div>
        ${metricRow}
        ${genderPopupRows}
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

  function autoZoomMapToFilteredData(countyData, layerGroup) {
    if (!basicMap || !layerGroup) return;

    const filteredCountyNames = new Set(
      Object.values(countyData)
        .filter(d => d.current > 0)
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
        basicMap.fitBounds(bounds, {
          padding: [45, 45],
          maxZoom: matchingLayers.length === 1 ? 8.8 : 7.6,
          animate: true,
          duration: 1.2
        });
      } else {
        basicMap.fitBounds(layerGroup.getBounds(), {
          padding: [25, 25],
          maxZoom: 6.2,
          animate: true,
          duration: 1.2
        });
      }

      setTimeout(() => basicMap.invalidateSize(), 150);
    } catch (e) {
      basicMap.setView([7.6, 30.2], 6);
    }
  }

  function renderBasicMap(rows) {
    if (!basicMap || !countyGeoJson) return;

    const countyData = groupCountyFull(rows);
    const values = Object.values(countyData).map(d => d.current).filter(v => v > 0);

    const minValue = values.length ? Math.min(...values) : 0;
    const maxValue = values.length ? Math.max(...values) : 0;

    if (countyLayer) {
      basicMap.removeLayer(countyLayer);
    }

    countyLayer = L.geoJSON(countyGeoJson, {
      style: feature => styleCounty(feature, countyData, minValue, maxValue),
      onEachFeature: (feature, layer) => {
        const countyName = feature.properties.ADM2_EN || "Unknown";
        const stateName = feature.properties.ADM1_EN || "Unknown";
        const d = countyData[normName(countyName)];

        layer.bindPopup(createPopupHtml(countyName, stateName, d), {
          maxWidth: 340,
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
    }).addTo(basicMap);

    autoZoomMapToFilteredData(countyData, countyLayer);
    renderMapSummary(countyData);
  }

  function renderMapSummary(countyData) {
    const counties = Object.values(countyData).filter(d => d.current > 0);

    setText("map-beneficiaries-label", metricLabel());

    setDisplay("map-beneficiaries-box", !selectedIsAncCoverage());
    setDisplay("map-male-box", !(selectedIsHealthFacilities() || selectedIsAncCoverage()));
    setDisplay("map-female-box", !selectedIsHealthFacilities());

    setText("map-counties", fmt(counties.length));
    setText("map-beneficiaries", fmt(counties.reduce((s, d) => s + d.current, 0)));
    setText("map-male", fmt(counties.reduce((s, d) => s + d.male, 0)));
    setText("map-female", fmt(counties.reduce((s, d) => s + d.female, 0)));

    const top = counties.sort((a, b) => b.current - a.current).slice(0, 5);
    const topEl = document.getElementById("map-top-counties");
    if (!topEl) return;

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


  function getRowsForMapSelector() {
    const indicator = indicatorFilter.value || "All";
    const agency = agencyFilter.value || "All";

    return geoRows(sectorRecords()).filter(r =>
      (indicator === "All" || r.indicator === indicator) &&
      (agency === "All" || r.agency === agency)
    );
  }

  function buildMapSelectorItems() {
    const rows = getRowsForMapSelector();
    const stateMap = {};
    const countyMap = {};

    rows.forEach(r => {
      const value = getBeneficiaryValue(r);

      if (r.state && r.state !== "Unknown") {
        if (!stateMap[r.state]) {
          stateMap[r.state] = { type: "State", name: r.state, state: r.state, current: 0 };
        }
        stateMap[r.state].current += value;
      }

      if (r.county && r.county !== "Unknown") {
        const key = `${r.state}||${r.county}`;
        if (!countyMap[key]) {
          countyMap[key] = { type: "County", name: r.county, state: r.state, current: 0 };
        }
        countyMap[key].current += value;
      }
    });

    return [...Object.values(stateMap), ...Object.values(countyMap)];
  }

  function updateMapSelectionPill() {
    if (!activeMapFilterPill) return;

    const total = selectedMapStates.size + selectedMapCounties.size;

    if (!total) {
      activeMapFilterPill.style.display = "none";
      activeMapFilterPill.textContent = "";
      return;
    }

    const labelParts = [];
    if (selectedMapStates.size) labelParts.push(`${selectedMapStates.size} state/admin area`);
    if (selectedMapCounties.size) labelParts.push(`${selectedMapCounties.size} county`);

    activeMapFilterPill.style.display = "inline-flex";
    activeMapFilterPill.textContent = `Map filter: ${labelParts.join(", ")}`;
  }

  function syncPendingFromAppliedSelection() {
    pendingMapStates = new Set(selectedMapStates);
    pendingMapCounties = new Set(selectedMapCounties);
  }

  function clearAppliedMapSelectionOnly() {
    selectedMapStates.clear();
    selectedMapCounties.clear();
    pendingMapStates.clear();
    pendingMapCounties.clear();
    updateMapSelectionPill();
  }

  function renderMapSelectorList() {
    if (!mapSelectorList) return;

    const search = (mapSelectorSearch?.value || "").trim().toLowerCase();
    const typeFilter = mapSelectorType?.value || "All";
    const sortValue = mapSelectorSort?.value || "value-desc";

    let items = buildMapSelectorItems();

    if (typeFilter !== "All") {
      items = items.filter(item => item.type === typeFilter);
    }

    if (search) {
      items = items.filter(item =>
        item.name.toLowerCase().includes(search) ||
        item.state.toLowerCase().includes(search) ||
        item.type.toLowerCase().includes(search)
      );
    }

    if (sortValue === "value-desc") {
      items.sort((a, b) => b.current - a.current || a.name.localeCompare(b.name));
    } else if (sortValue === "value-asc") {
      items.sort((a, b) => a.current - b.current || a.name.localeCompare(b.name));
    } else {
      items.sort((a, b) => a.name.localeCompare(b.name));
    }

    const selectedCount = pendingMapStates.size + pendingMapCounties.size;
    if (mapSelectorCount) {
      mapSelectorCount.textContent = `${selectedCount} selected`;
    }

    if (!items.length) {
      mapSelectorList.innerHTML = `<div class="drawer-empty">No states or counties match the current search.</div>`;
      return;
    }

    mapSelectorList.innerHTML = items.map(item => {
      const checked = item.type === "State"
        ? pendingMapStates.has(item.name)
        : pendingMapCounties.has(item.name);

      const meta = item.type === "State"
        ? "State/Admin Area"
        : `County · ${item.state}`;

      return `
        <label class="drawer-row" data-type="${escapeHtml(item.type)}" data-name="${escapeHtml(item.name)}">
          <input type="checkbox" ${checked ? "checked" : ""} data-type="${escapeHtml(item.type)}" data-name="${escapeHtml(item.name)}" data-state="${escapeHtml(item.state)}"/>
          <div>
            <div class="drawer-name">${escapeHtml(item.name)}</div>
            <div class="drawer-meta">${escapeHtml(meta)}</div>
          </div>
          <div class="drawer-value">${fmt(item.current)}</div>
        </label>
      `;
    }).join("");

    mapSelectorList.querySelectorAll("input[type='checkbox']").forEach(input => {
      input.addEventListener("change", () => {
        const type = input.dataset.type;
        const name = input.dataset.name;

        if (type === "State") {
          if (input.checked) pendingMapStates.add(name);
          else pendingMapStates.delete(name);
        }

        if (type === "County") {
          if (input.checked) pendingMapCounties.add(name);
          else pendingMapCounties.delete(name);
        }

        if (mapSelectorCount) {
          mapSelectorCount.textContent = `${pendingMapStates.size + pendingMapCounties.size} selected`;
        }
      });
    });
  }

  function openMapSelector() {
    syncPendingFromAppliedSelection();
    renderMapSelectorList();

    mapDrawerOverlay?.classList.add("open");
    mapSelectorDrawer?.classList.add("open");
    if (mapSelectorDrawer) mapSelectorDrawer.setAttribute("aria-hidden", "false");

    setTimeout(() => mapSelectorSearch?.focus(), 120);
  }

  function closeMapSelector() {
    mapDrawerOverlay?.classList.remove("open");
    mapSelectorDrawer?.classList.remove("open");
    if (mapSelectorDrawer) mapSelectorDrawer.setAttribute("aria-hidden", "true");
  }

  function clearMapSelection() {
    pendingMapStates.clear();
    pendingMapCounties.clear();
    selectedMapStates.clear();
    selectedMapCounties.clear();

    stateFilter.value = "All";
    countyFilter.value = "All";

    updateMapSelectionPill();
    renderMapSelectorList();
    renderDashboard();
  }

  function applyMapSelection() {
    selectedMapStates = new Set(pendingMapStates);
    selectedMapCounties = new Set(pendingMapCounties);

    // Keep the drawer selection as the main geographic filter.
    // This avoids conflict with the existing dropdowns.
    stateFilter.value = "All";
    countyFilter.value = "All";

    updateMapSelectionPill();
    closeMapSelector();
    renderDashboard();
  }

  function renderSimpleInsights(rows, rowsForGeo) {
    const container = document.getElementById("simple-insights-list");
    if (!container) return;

    const selectedIndicator = indicatorFilter.value || "All";
    const selectedAgency = agencyFilter.value || "All";
    const selectedState = stateFilter.value || "All";
    const selectedCounty = countyFilter.value || "All";

    const hasIndicator = selectedIndicator !== "All";
    const hasAgency = selectedAgency !== "All";
    const hasState = selectedState !== "All";
    const hasCounty = selectedCounty !== "All";

    const beneficiaryRows =
      currentSector === "Health" && !selectedIsHealthFacilities() && !selectedIsHealthEmergencies()
        ? rowsForGeo.filter(r =>
            normText(r.indicator) === "people accessing health services" ||
            normText(r.indicator) === "antenatal care coverage" ||
            normText(r.indicator).includes("public health emergencies")
          )
        : rowsForGeo;

    let total;

    if (selectedIsHealthFacilities() || selectedIsHealthEmergencies()) {
      total = rowsForGeo.reduce((s, r) => s + Number(r.current || 0), 0);
    } else if (selectedIsAncCoverage()) {
      total = rowsForGeo.reduce((s, r) => s + Number(r.female || 0), 0);
    } else if (currentSector === "Health") {
      total = getHealthBeneficiaryTotal(rows);
    } else {
      total = beneficiaryRows.reduce((s, r) => s + getBeneficiaryValue(r), 0);
    }

    if (!rows.length || total <= 0) {
      container.innerHTML = `<div class="simple-insight-item">No records match the selected filters.</div>`;
      return;
    }

    const stateTotals = groupSum(beneficiaryRows, "state");
    const countyTotals = groupSum(beneficiaryRows, "county");
    const agencyTotals = groupSum(
      selectedIsAncCoverage() ? beneficiaryRows : agencyCountRows(beneficiaryRows),
      "agency"
    );

    const topState = Object.entries(stateTotals)
      .filter(([n, v]) => n && n !== "Unknown" && v > 0)
      .sort((a, b) => b[1] - a[1])[0];

    const topCounty = Object.entries(countyTotals)
      .filter(([n, v]) => n && n !== "Unknown" && v > 0)
      .sort((a, b) => b[1] - a[1])[0];

    const topAgency = Object.entries(agencyTotals)
      .filter(([n, v]) => n && n !== "Unknown" && v > 0)
      .sort((a, b) => b[1] - a[1])[0];

    const indicatorGrouped = groupIndicators(progressRows(rows))
      .filter(d => d.target && d.current > 0)
      .map(d => ({ ...d, pct: (d.current / d.target) * 100 }))
      .sort((a, b) => a.pct - b.pct);

    const weakest = indicatorGrouped[0];
    const strongest = indicatorGrouped[indicatorGrouped.length - 1];
    const selectedProgress = indicatorGrouped.find(d => d.indicator === selectedIndicator);

    const male = rowsForGeo.reduce((s, r) => s + r.male, 0);
    const female = rowsForGeo.reduce((s, r) => s + r.female, 0);
    const sexTotal = male + female;
    const femalePct = sexTotal > 0 ? ((female / sexTotal) * 100).toFixed(1) : null;

    const countyCount = new Set(
      beneficiaryRows.map(r => r.county).filter(c => c && c !== "Unknown")
    ).size;

    const stateCount = new Set(
      beneficiaryRows.map(r => r.state).filter(s => s && s !== "Unknown")
    ).size;

    const entityCount = new Set(
      (selectedIsAncCoverage() ? beneficiaryRows : agencyCountRows(beneficiaryRows))
        .map(r => r.agency)
        .filter(a => a && a !== "Unknown")
    ).size;

    const indicatorCount = new Set(
      rows.map(r => r.indicator).filter(i => i && i !== "Unknown")
    ).size;

    function pct(value, base = total) {
      return base > 0 ? ((value / base) * 100).toFixed(1) : "0.0";
    }

    function renderCards(insights) {
      container.innerHTML = insights.slice(0, 6).map(text => `
        <div class="simple-insight-item">${text}</div>
      `).join("");
    }

    const metric = selectedIsHealthFacilities()
      ? "health facilities"
      : selectedIsHealthEmergencies()
        ? "health emergencies"
        : currentSector === "Nutrition"
          ? "nutrition beneficiaries"
          : currentSector === "Education"
            ? "education beneficiaries"
            : "reported people";

    let insights = [];

    if (hasIndicator) {
      insights.push(
        `<strong>${escapeHtml(selectedIndicator)}</strong> recorded <span class="insight-blue">${fmt(total)}</span> ${metric} in the current selection.`
      );

      if (selectedProgress) {
        insights.push(
          `<strong>${escapeHtml(selectedIndicator)}</strong> achieved <span class="${selectedProgress.pct >= 100 ? "insight-good" : "insight-blue"}">${selectedProgress.pct.toFixed(1)}%</span> of target against <strong>${fmt(selectedProgress.target)}</strong>.`
        );
      }
    } else if (hasAgency) {
      insights.push(
        `<strong>${escapeHtml(selectedAgency)}</strong> reported <span class="insight-blue">${fmt(total)}</span> ${metric} across selected indicators.`
      );

      if (strongest) {
        insights.push(
          `<strong>${escapeHtml(strongest.indicator)}</strong> is the strongest target-linked indicator for ${escapeHtml(selectedAgency)} at <span class="${strongest.pct >= 100 ? "insight-good" : "insight-blue"}">${strongest.pct.toFixed(1)}%</span> of target.`
        );
      }

      if (weakest && strongest && weakest.indicator !== strongest.indicator) {
        insights.push(
          `<strong>${escapeHtml(weakest.indicator)}</strong> is the lowest target-linked indicator for ${escapeHtml(selectedAgency)} at <span class="insight-warn">${weakest.pct.toFixed(1)}%</span> of target.`
        );
      }
    } else if (hasCounty) {
      insights.push(
        `<strong>${escapeHtml(selectedCounty)}</strong> has <span class="insight-blue">${fmt(total)}</span> ${metric} in the current selection.`
      );

      if (topState) {
        insights.push(
          `<strong>${escapeHtml(topState[0])}</strong> is the associated state/admin area for the selected county.`
        );
      }

      if (strongest) {
        insights.push(
          `<strong>${escapeHtml(strongest.indicator)}</strong> is the strongest target-linked indicator in ${escapeHtml(selectedCounty)} at <span class="${strongest.pct >= 100 ? "insight-good" : "insight-blue"}">${strongest.pct.toFixed(1)}%</span> of target.`
        );
      }
    } else if (hasState) {
      insights.push(
        `<strong>${escapeHtml(selectedState)}</strong> has <span class="insight-blue">${fmt(total)}</span> ${metric} across <strong>${fmt(countyCount)}</strong> county/counties.`
      );

      if (topCounty) {
        insights.push(
          `<strong>${escapeHtml(topCounty[0])}</strong> is the highest county in ${escapeHtml(selectedState)}, contributing <span class="insight-blue">${pct(topCounty[1])}%</span> of selected results.`
        );
      }

      if (strongest) {
        insights.push(
          `<strong>${escapeHtml(strongest.indicator)}</strong> is the strongest target-linked indicator in ${escapeHtml(selectedState)} at <span class="${strongest.pct >= 100 ? "insight-good" : "insight-blue"}">${strongest.pct.toFixed(1)}%</span> of target.`
        );
      }
    } else {
      insights.push(
        `<strong>${escapeHtml(currentSector)}</strong> recorded <span class="insight-blue">${fmt(total)}</span> total ${metric} across all selected records.`
      );

      if (strongest) {
        insights.push(
          `<strong>${escapeHtml(strongest.indicator)}</strong> is the strongest target-linked indicator at <span class="${strongest.pct >= 100 ? "insight-good" : "insight-blue"}">${strongest.pct.toFixed(1)}%</span> of target.`
        );
      }

      if (weakest && strongest && weakest.indicator !== strongest.indicator) {
        insights.push(
          `<strong>${escapeHtml(weakest.indicator)}</strong> remains the lowest target-linked indicator at <span class="insight-warn">${weakest.pct.toFixed(1)}%</span> of target.`
        );
      }
    }

    if (topState && !hasCounty && !hasState) {
      insights.push(
        `<strong>${escapeHtml(topState[0])}</strong> is the leading state/admin area, accounting for <span class="insight-blue">${pct(topState[1])}%</span> of selected results.`
      );
    }

    if (topCounty && !hasCounty) {
      insights.push(
        `<strong>${escapeHtml(topCounty[0])}</strong> is the highest county, contributing <span class="insight-blue">${pct(topCounty[1])}%</span> of selected results.`
      );
    }

    if (topAgency) {
      insights.push(
        `<strong>${escapeHtml(topAgency[0])}</strong> is the leading reporting entity, contributing <span class="insight-blue">${pct(topAgency[1])}%</span> of selected results.`
      );
    }

    if (femalePct && !selectedIsHealthFacilities() && !selectedIsAncCoverage()) {
      insights.push(
        `Female beneficiaries account for <span class="insight-blue">${femalePct}%</span> of reported sex-disaggregated data.`
      );
    }

    if (!hasState && !hasCounty && !selectedIsHealthFacilities()) {
      insights.push(
        `Selected data covers <strong>${fmt(countyCount)}</strong> county/counties and <strong>${fmt(entityCount)}</strong> reporting entity/entities.`
      );
    }

    if (selectedIsHealthFacilities()) {
      insights.push(
        `Selected data covers <strong>${fmt(countyCount)}</strong> county/counties across <strong>${fmt(stateCount)}</strong> state/admin area(s).`
      );
    }

    if (hasCounty) {
      insights.push(
        `The selected county includes <strong>${fmt(indicatorCount)}</strong> reported indicator(s) and <strong>${fmt(entityCount)}</strong> reporting entity/entities.`
      );
    }

    renderCards(insights);
  }


  function setVisualView(viewName) {
    activeVisualView = viewName === "agency" ? "agency" : "map";

    viewMapBtn?.classList.toggle("active", activeVisualView === "map");
    viewAgencyRankingBtn?.classList.toggle("active", activeVisualView === "agency");

    if (viewMapBtn) viewMapBtn.setAttribute("aria-selected", activeVisualView === "map" ? "true" : "false");
    if (viewAgencyRankingBtn) viewAgencyRankingBtn.setAttribute("aria-selected", activeVisualView === "agency" ? "true" : "false");

    basicMapViewPanel?.classList.toggle("active", activeVisualView === "map");
    basicAgencyRankingPanel?.classList.toggle("active", activeVisualView === "agency");

    if (activeVisualView === "map" && basicMap) {
      setTimeout(() => basicMap.invalidateSize(), 180);
    }

    if (activeVisualView === "agency" && typeof Plotly !== "undefined") {
      const chart = document.getElementById("agency-ranking-chart");
      if (chart) setTimeout(() => Plotly.Plots.resize(chart), 120);
    }
  }

  function setPlainText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function renderAgencyRankingView(rows) {
    const el = document.getElementById("agency-ranking-chart");
    if (!el || typeof Plotly === "undefined") return;

    const agencyTotals = groupSum(rows, "agency");
    const entries = Object.entries(agencyTotals)
      .filter(([name, value]) => name && name !== "Unknown" && Number(value) > 0)
      .sort((a, b) => Number(b[1]) - Number(a[1]));

    const total = entries.reduce((s, [, value]) => s + Number(value || 0), 0);
    const leading = entries[0];

    setPlainText("agency-rank-leading", leading ? leading[0] : "—");
    setPlainText("agency-rank-share", leading && total ? `${((leading[1] / total) * 100).toFixed(1)}%` : "—");
    setPlainText("agency-rank-total", fmt(total));

    if (!entries.length) {
      Plotly.purge("agency-ranking-chart");
      el.innerHTML = `<div class="empty-chart">No agency ranking data available</div>`;
      return;
    }

    const chartEntries = entries.slice(0, 14).reverse();
    const names = chartEntries.map(d => d[0]);
    const values = chartEntries.map(d => Number(d[1] || 0));
    const maxValue = Math.max(...values);

    Plotly.newPlot("agency-ranking-chart", [{
      type: "bar",
      orientation: "h",
      y: names,
      x: values,
      marker: {
        color: names.map((name, index) => getAgencyColor(name, index)),
        line: { color: "rgba(255,255,255,0.16)", width: 1 }
      },
      text: values.map(v => fmt(v)),
      textposition: "outside",
      customdata: values.map(v => total ? (v / total) * 100 : 0),
      cliponaxis: false,
      hovertemplate: `<b>%{y}</b><br>${metricLabel()}: %{x:,}<br>Share of filtered total: %{customdata:.1f}%<extra></extra>`
    }], {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#8ba8c4", family: "Inter, sans-serif" },
      margin: { t: 20, r: 135, b: 55, l: 220 },
      bargap: 0.28,
      xaxis: {
        range: [0, maxValue * 1.18],
        gridcolor: "rgba(0,158,219,0.12)",
        zeroline: false,
        tickfont: { size: 11 },
        automargin: true
      },
      yaxis: {
        automargin: true,
        tickfont: { size: 12 }
      }
    }, {
      displayModeBar: false,
      responsive: true
    });
  }

  async function renderDashboard(changedFilter = "") {
    refreshDependentFilters(changedFilter);

    updateMapSelectionPill();
    if (mapSelectorDrawer?.classList.contains("open")) {
      renderMapSelectorList();
    }

    const rows = getFilteredRecords();
    const rowsForGeo = geoRows(rows);
    const rowsForProgress = progressRows(rows);

    const rowsForAgencyCharts =
      selectedIsAncCoverage()
        ? rowsForGeo
        : agencyCountRows(rowsForGeo);

    const rowsForStateCountyCharts =
      selectedIsAncCoverage() || selectedIsHealthFacilities() || selectedIsHealthEmergencies()
        ? rowsForGeo
        : rowsForAgencyCharts;

    renderKpis(rows);
    renderSimpleInsights(rows, rowsForGeo);
    renderTable(rowsForProgress);
    renderIndicatorAgencyChart(rowsForProgress);

    renderStackedAgencyBarChart("state-chart", rowsForStateCountyCharts, "state", 13);
    renderStackedAgencyBarChart("county-chart", rowsForStateCountyCharts, "county", 12);
    renderAgencyRankingView(rowsForAgencyCharts);

    setText("map-section-title", `Geographical Coverage by ${metricLabel()}`);

    if (!mapInitialized) {
      await initBasicMap();
    }

    renderBasicMap(rowsForGeo);
  }

  function initializeFilters() {
    const indicatorOptions = sectorRecords()
      .filter(r => !(currentSector === "Health" && isTotalAncRow(r)))
      .map(r => r.indicator);

    setOptions(indicatorFilter, uniqueSorted(indicatorOptions));

    let agencyBase = sectorRecords();
    if (currentSector === "Health") agencyBase = agencyCountRows(geoRows(agencyBase));

    setOptions(agencyFilter, uniqueSorted(agencyBase.map(r => r.agency)));
    setOptions(stateFilter, uniqueSorted(geoRows(sectorRecords()).map(r => r.state)));
    setOptions(countyFilter, uniqueSorted(geoRows(sectorRecords()).map(r => r.county)));

    indicatorFilter.addEventListener("change", () => renderDashboard("indicator"));
    agencyFilter.addEventListener("change", () => renderDashboard("agency"));
    stateFilter.addEventListener("change", () => {
      clearAppliedMapSelectionOnly();
      renderDashboard("state");
    });
    countyFilter.addEventListener("change", () => {
      clearAppliedMapSelectionOnly();
      renderDashboard("county");
    });

    viewMapBtn?.addEventListener("click", () => setVisualView("map"));
    viewAgencyRankingBtn?.addEventListener("click", () => setVisualView("agency"));

    openMapSelectorBtn?.addEventListener("click", openMapSelector);
    closeMapSelectorBtn?.addEventListener("click", closeMapSelector);
    mapDrawerOverlay?.addEventListener("click", closeMapSelector);
    mapSelectorSearch?.addEventListener("input", renderMapSelectorList);
    mapSelectorType?.addEventListener("change", renderMapSelectorList);
    mapSelectorSort?.addEventListener("change", renderMapSelectorList);
    clearMapSelectionBtn?.addEventListener("click", clearMapSelection);
    applyMapSelectionBtn?.addEventListener("click", applyMapSelection);

    document.addEventListener("keydown", e => {
      if (e.key === "Escape") closeMapSelector();
    });

    resetBtn.addEventListener("click", () => {
      indicatorFilter.value = "All";
      agencyFilter.value = "All";
      stateFilter.value = "All";
      countyFilter.value = "All";
      clearAppliedMapSelectionOnly();
      renderDashboard();
    });

    document.querySelectorAll(".sector-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        currentSector = btn.dataset.sector;
        document.querySelectorAll(".sector-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        clearAppliedMapSelectionOnly();
        renderDashboard("sector");
      });
    });
  }

  function showWarning(message) {
    if (!warningBox) return;
    warningBox.textContent = message;
    warningBox.style.display = "block";
  }

  window.toggleBasicIndicatorTable = function () {
    const panel = document.getElementById("indicator-table-panel");
    const btn = document.getElementById("indicator-table-toggle");
    if (!panel || !btn) return;

    const isHidden = panel.style.display === "none" || panel.style.display === "";
    panel.style.display = isHidden ? "block" : "none";
    btn.textContent = isHidden ? "Hide Detailed Table" : "Show Detailed Table";
  };

  function rowsToCsv(rows) {
    return rows.map(row => row.map(value => {
      const text = String(value ?? "");
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join(",")).join("\n");
  }

  function triggerCsvDownload(filename, csvText) {
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  window.downloadBasicChartCSV = function (type) {
    const rows = getFilteredRecords();
    const rowsForGeo = geoRows(rows);
    const rowsForProgress = progressRows(rows);
    let csvRows = [];

    if (type === "state") {
      csvRows = [["State/Admin Area", metricLabel()]];
      Object.entries(groupSum(rowsForGeo, "state"))
        .filter(([n, v]) => n && n !== "Unknown" && v > 0)
        .sort((a, b) => b[1] - a[1])
        .forEach(([n, v]) => csvRows.push([n, v]));
    }

    if (type === "county") {
      csvRows = [["County", metricLabel()]];
      Object.entries(groupSum(rowsForGeo, "county"))
        .filter(([n, v]) => n && n !== "Unknown" && v > 0)
        .sort((a, b) => b[1] - a[1])
        .forEach(([n, v]) => csvRows.push([n, v]));
    }

    if (type === "agency") {
      const rowsForAgencyCsv = selectedIsAncCoverage() ? rowsForGeo : agencyCountRows(rowsForGeo);
      csvRows = [["Reporting Entity", metricLabel(), "Share %"]];
      const agencyEntries = Object.entries(groupSum(rowsForAgencyCsv, "agency"))
        .filter(([n, v]) => n && n !== "Unknown" && v > 0)
        .sort((a, b) => b[1] - a[1]);
      const agencyTotal = agencyEntries.reduce((s, [, v]) => s + Number(v || 0), 0);
      agencyEntries.forEach(([n, v]) => {
        csvRows.push([n, v, agencyTotal ? ((v / agencyTotal) * 100).toFixed(1) : "0.0"]);
      });
    }

    if (type === "indicatorAgency") {
      csvRows = [["Sector", "Indicator", "Reporting Agencies", "Current Number", "Target", "Achievement %"]];

      groupIndicators(rowsForProgress).forEach(d => {
        csvRows.push([
          currentSector,
          d.indicator,
          [...d.agencies].sort().join(", "),
          d.isCoverage ? d.current.toFixed(1) : d.current,
          d.target,
          d.target ? ((d.current / d.target) * 100).toFixed(1) : ""
        ]);
      });
    }

    if (csvRows.length) {
      triggerCsvDownload(
        `basic_services_${currentSector.toLowerCase()}_${type}_chart_data.csv`,
        rowsToCsv(csvRows)
      );
    }
  };

  window.downloadBasicChartPNG = function (chartId, fileName) {
    if (typeof Plotly === "undefined") return;

    const chart = document.getElementById(chartId);
    if (!chart || !chart.data) return;

    Plotly.downloadImage(chart, {
      format: "png",
      filename: fileName,
      height: 850,
      width: 1400,
      scale: 2
    });
  };

  initializeFilters();
  renderDashboard();

  window.addEventListener("resize", () => {
    ["state-chart", "county-chart", "indicator-agency-chart", "agency-ranking-chart"].forEach(id => {
      const el = document.getElementById(id);
      if (el && typeof Plotly !== "undefined") Plotly.Plots.resize(el);
    });

    if (basicMap) {
      setTimeout(() => basicMap.invalidateSize(), 150);
    }
  });
});