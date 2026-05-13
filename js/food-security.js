document.addEventListener("DOMContentLoaded", () => {
  const warningBox = document.getElementById("data-warning");

  if (typeof CO_DATA === "undefined" || !CO_DATA.foodSecurity || !Array.isArray(CO_DATA.foodSecurity.records)) {
    showWarning("Data was not loaded. Please regenerate js/data.js from the updated Excel file, then refresh the page with Ctrl + Shift + R.");
    return;
  }

  const data = CO_DATA.foodSecurity;
  const records = (data.records || []).map(normalizeRecord);

  const ADMIN_AREAS = data.adminAreas || [
    "Abyei Region",
    "Pibor Administrative Area",
    "Ruweng Administrative Area",
    "Abyei",
    "Pibor",
    "Ruweng"
  ];

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
  const foodMapViewPanel = document.getElementById("food-map-view-panel");
  const foodAgencyRankingPanel = document.getElementById("food-agency-ranking-panel");

  let selectedMapStates = new Set();
  let selectedMapCounties = new Set();
  let pendingMapStates = new Set();
  let pendingMapCounties = new Set();

  let foodMap = null;
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
      indicator: clean(r.indicator),
      agency: clean(r.agency),
      state: clean(r.state),
      county: clean(r.county),
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

  function setOptions(select, values, allLabel = "All") {
    if (!select) return;

    const current = select.value || "All";

    select.innerHTML =
      `<option value="All">${allLabel}</option>` +
      values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");

    select.value = [...select.options].some(o => o.value === current) ? current : "All";
  }

  function getFilteredRecords() {
    const indicator = indicatorFilter.value || "All";
    const agency = agencyFilter.value || "All";
    const state = stateFilter.value || "All";
    const county = countyFilter.value || "All";

    return records.filter(r => {
      const matchesTopFilters =
        (indicator === "All" || r.indicator === indicator) &&
        (agency === "All" || r.agency === agency) &&
        (state === "All" || r.state === state) &&
        (county === "All" || r.county === county);

      const matchesMapState =
        selectedMapStates.size === 0 || selectedMapStates.has(r.state);

      const matchesMapCounty =
        selectedMapCounties.size === 0 || selectedMapCounties.has(r.county);

      return matchesTopFilters && matchesMapState && matchesMapCounty;
    });
  }

  function refreshDependentFilters(changedFilter = "") {
    let filtered = records;

    // Reset lower-level filters when an upper-level filter changes.
    // This keeps the dropdowns clean and prevents invalid combinations.
    if (changedFilter === "indicator") {
      agencyFilter.value = "All";
      stateFilter.value = "All";
      countyFilter.value = "All";
    }

    if (changedFilter === "agency") {
      stateFilter.value = "All";
      countyFilter.value = "All";
    }

    if (changedFilter === "state") {
      countyFilter.value = "All";
    }

    // 1) Indicator options are based on all Food Security records.
    setOptions(
      indicatorFilter,
      uniqueSorted(records.map(r => r.indicator)),
      "All"
    );

    // 2) Apply selected indicator before building Agency options.
    if (indicatorFilter.value !== "All") {
      filtered = filtered.filter(r => r.indicator === indicatorFilter.value);
    }

    // 3) Agency options depend on selected Indicator.
    setOptions(
      agencyFilter,
      uniqueSorted(filtered.map(r => r.agency)),
      "All"
    );

    // 4) Apply selected agency before building State/Admin Area options.
    if (agencyFilter.value !== "All") {
      filtered = filtered.filter(r => r.agency === agencyFilter.value);
    }

    // 5) State/Admin Area options depend on selected Indicator + Agency.
    setOptions(
      stateFilter,
      uniqueSorted(filtered.map(r => r.state)),
      "All"
    );

    // 6) Apply selected State/Admin Area before building County options.
    if (stateFilter.value !== "All") {
      filtered = filtered.filter(r => r.state === stateFilter.value);
    }

    // 7) County options depend on all selections above.
    setOptions(
      countyFilter,
      uniqueSorted(filtered.map(r => r.county)),
      "All"
    );
  }

  function groupSum(rows, field) {
    return rows.reduce((out, r) => {
      const key = r[field] || "Unknown";
      out[key] = (out[key] || 0) + Number(r.current || 0);
      return out;
    }, {});
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
      grouped[key].current += r.current;
      grouped[key].male += r.male;
      grouped[key].female += r.female;
    });

    return grouped;
  }

  function groupIndicators(rows) {
    const grouped = {};

    rows.forEach(r => {
      if (!grouped[r.indicator]) {
        grouped[r.indicator] = {
          indicator: r.indicator,
          agencies: new Set(),
          current: 0,
          target: Number(r.target || 0)
        };
      }

      grouped[r.indicator].agencies.add(r.agency);
      grouped[r.indicator].current += Number(r.current || 0);

      if (!grouped[r.indicator].target && r.target) {
        grouped[r.indicator].target = Number(r.target || 0);
      }
    });

    return Object.values(grouped).sort((a, b) => b.current - a.current);
  }

  function renderKpis(rows) {
    const states = new Set();
    const adminAreas = new Set();
    const counties = new Set();
    const agencies = new Set();

    rows.forEach(r => {
      if (ADMIN_AREAS.includes(r.state)) {
        adminAreas.add(r.state);
      } else if (r.state !== "Unknown") {
        states.add(r.state);
      }

      if (r.county !== "Unknown") counties.add(r.county);
      if (r.agency !== "Unknown") agencies.add(r.agency);
    });

    setText("kpi-states", fmt(states.size));
    setText("kpi-admin-areas", fmt(adminAreas.size));
    setText("kpi-counties", fmt(counties.size));
    setText("kpi-agencies", fmt(agencies.size));
    setText("kpi-current", fmt(rows.reduce((s, r) => s + r.current, 0)));
    setText("kpi-male", fmt(rows.reduce((s, r) => s + r.male, 0)));
    setText("kpi-female", fmt(rows.reduce((s, r) => s + r.female, 0)));
  }

  function renderTable(rows) {
    const tbody = document.getElementById("indicator-table");
    if (!tbody) return;

    const grouped = groupIndicators(rows);

    if (!grouped.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No records match the selected filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = grouped.map(d => {
      const achieved = d.target ? `${((d.current / d.target) * 100).toFixed(1)}%` : "—";

      return `
        <tr>
          <td>${escapeHtml(d.indicator)}</td>
          <td>${escapeHtml([...d.agencies].sort().join(", "))}</td>
          <td class="total-col">${fmt(d.current)}</td>
          <td>${fmt(d.target)}</td>
          <td class="total-col">${achieved}</td>
        </tr>
      `;
    }).join("");
  }

  function renderBarChart(id, obj, limit = 12, color = "#009EDB") {
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
    const rightMargin = maxValue > 999999 ? 105 : 80;

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
      hovertemplate: "<b>%{y}</b><br>%{x:,}<extra></extra>"
    }], {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#8ba8c4", family: "Inter, sans-serif" },
      margin: { t: 18, r: rightMargin, b: 42, l: 190 },
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

  function renderAgencyColorBarChart(id, obj, limit = 10) {
    const el = document.getElementById(id);
    if (!el || typeof Plotly === "undefined") return;

    const agencyColors = {
      WFP: "#FFD97A",
      FAO: "#00AEEF",
      NGOs: "#2ED3B7",
      NGO: "#2ED3B7"
    };

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

    const names = entries.map(d => d[0]);
    const values = entries.map(d => d[1]);
    const total = values.reduce((s, v) => s + Number(v || 0), 0);

    Plotly.newPlot(id, [{
      type: "bar",
      orientation: "h",
      y: names,
      x: values,
      marker: {
        color: names.map(a => agencyColors[a] || "#A66CFF"),
        line: { color: "rgba(255,255,255,0.16)", width: 1 }
      },
      text: values.map(v => fmt(v)),
      textposition: "outside",
      customdata: values.map(v => total ? (v / total) * 100 : 0),
      cliponaxis: false,
      hovertemplate: "<b>%{y}</b><br>Current: %{x:,}<br>Share: %{customdata:.1f}%<extra></extra>"
    }], {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#8ba8c4", family: "Inter, sans-serif" },
      margin: { t: 18, r: 110, b: 42, l: 190 },
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

  function renderStackedAgencyBarChart(id, rows, groupField, limit = 12) {
    const el = document.getElementById(id);
    if (!el || typeof Plotly === "undefined") return;

    const agencyColors = {
      WFP: "#FFD97A",
      FAO: "#00AEEF",
      NGOs: "#2ED3B7",
      NGO: "#2ED3B7"
    };

    const agencies = ["WFP", "FAO", "NGOs"].filter(a => rows.some(r => r.agency === a));
    const grouped = {};

    rows.forEach(r => {
      const groupName = r[groupField] || "Unknown";
      const agency = r.agency || "Unknown";

      if (!groupName || groupName === "Unknown") return;

      if (!grouped[groupName]) {
        grouped[groupName] = {
          total: 0,
          agencies: {}
        };
      }

      grouped[groupName].total += Number(r.current || 0);
      grouped[groupName].agencies[agency] =
        (grouped[groupName].agencies[agency] || 0) + Number(r.current || 0);
    });

    const entries = Object.entries(grouped)
      .filter(([name, d]) => name && name !== "Unknown" && d.total > 0)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, limit)
      .reverse();

    if (!entries.length) {
      Plotly.purge(id);
      el.innerHTML = `<div class="empty-chart">No data available</div>`;
      return;
    }

    const yLabels = entries.map(([name]) => name);
    const totals = entries.map(([, d]) => d.total);

    const traces = agencies.map(agency => ({
      type: "bar",
      orientation: "h",
      name: agency,
      y: yLabels,
      x: entries.map(([, d]) => d.agencies[agency] || 0),
      marker: {
        color: agencyColors[agency] || "#A66CFF",
        line: { color: "rgba(255,255,255,0.16)", width: 1 }
      },
      customdata: entries.map(([, d]) => [
        d.total,
        d.agencies[agency] || 0,
        d.total ? ((d.agencies[agency] || 0) / d.total) * 100 : 0
      ]),
      hovertemplate:
        "<b>%{y}</b><br>" +
        agency + ": %{customdata[1]:,}<br>" +
        "Agency share: %{customdata[2]:.1f}%<br>" +
        "Total: %{customdata[0]:,}" +
        "<extra></extra>"
    }));

    const totalLabels = {
      type: "scatter",
      mode: "text",
      showlegend: false,
      y: yLabels,
      x: totals,
      text: totals.map(v => fmt(v)),
      textposition: "middle right",
      textfont: {
        color: "#B8D9F7",
        size: 11,
        family: "Inter, sans-serif"
      },
      hoverinfo: "skip",
      cliponaxis: false
    };

    const maxValue = Math.max(...totals);

    Plotly.newPlot(id, [...traces, totalLabels], {
      barmode: "stack",
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#8ba8c4", family: "Inter, sans-serif" },
      margin: { t: 18, r: 110, b: 50, l: 190 },
      bargap: 0.32,
      xaxis: {
        range: [0, maxValue * 1.16],
        gridcolor: "rgba(0,158,219,0.12)",
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
        y: -0.18,
        font: { size: 12 },
        bgcolor: "rgba(0,0,0,0)"
      }
    }, {
      displayModeBar: false,
      responsive: true
    });
  }

  function renderGenderChart(rows) {
    const el = document.getElementById("gender-chart");
    if (!el || typeof Plotly === "undefined") return;

    const male = rows.reduce((s, r) => s + r.male, 0);
    const female = rows.reduce((s, r) => s + r.female, 0);

    if (!male && !female) {
      Plotly.purge("gender-chart");
      el.innerHTML = `<div class="empty-chart">No gender data available</div>`;
      return;
    }

    Plotly.newPlot("gender-chart", [{
      type: "pie",
      labels: ["Male", "Female"],
      values: [male, female],
      hole: 0.62,
      marker: {
        colors: ["#60a5fa", "#f472b6"],
        line: { color: "#122a4d", width: 2 }
      },
      textinfo: "percent",
      textfont: { color: "#e8f1fa", size: 13 },
      hovertemplate: "<b>%{label}</b><br>%{value:,}<br>%{percent}<extra></extra>"
    }], {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#8ba8c4", family: "Inter, sans-serif" },
      margin: { t: 15, r: 20, b: 15, l: 20 },
      legend: {
        orientation: "v",
        x: 1,
        y: 0.5,
        font: { size: 12 }
      },
      annotations: [{
        text: `<b>${fmt(male + female)}</b><br><span style="font-size:11px;color:#8ba8c4">Total</span>`,
        showarrow: false,
        x: 0.5,
        y: 0.5,
        font: { color: "#e8f1fa", size: 15 }
      }]
    }, {
      displayModeBar: false,
      responsive: true
    });
  }

  async function initFoodMap() {
    if (mapInitialized || typeof L === "undefined") return;

    const mapEl = document.getElementById("food-map");
    if (!mapEl) return;

    foodMap = L.map("food-map", {
      zoomControl: true,
      attributionControl: false
    }).setView([7.6, 30.2], 6);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 12
    }).addTo(foodMap);

    L.control.attribution({
      prefix: false
    }).addAttribution("&copy; OpenStreetMap &copy; CARTO").addTo(foodMap);

    try {
      const res = await fetch("data/SouthSudan.json?v=20260501");
      if (!res.ok) throw new Error("Could not load data/SouthSudan.json");

      countyGeoJson = await res.json();
      mapInitialized = true;

      setTimeout(() => foodMap.invalidateSize(), 150);
    } catch (err) {
      showWarning("Map boundary file was not loaded. Please place SouthSudan.json inside the data folder: data/SouthSudan.json");
      console.error(err);
    }
  }

  function getQuantileBreaks(values) {
    const sorted = values
      .map(v => Number(v || 0))
      .filter(v => v > 0)
      .sort((a, b) => a - b);

    if (!sorted.length) return [0, 0, 0];

    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q2 = sorted[Math.floor(sorted.length * 0.50)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];

    return [q1, q2, q3];
  }

  function getColor(value, breaks) {
    if (!value || value <= 0) return "#3b3b3b";

    const [q1, q2, q3] = breaks;

    if (value >= q3) return "#1f4e79";
    if (value >= q2) return "#4f93c9";
    if (value >= q1) return "#9ccbe6";
    return "#d6e8f5";
  }

  function styleCounty(feature, countyData, breaks) {
    const countyName = feature.properties.ADM2_EN || "";
    const stateName = feature.properties.ADM1_EN || "";
    const d = countyData[normName(countyName)];
    const value = d ? Number(d.current || 0) : 0;

    const isSelected =
      selectedMapCounties.has(countyName) ||
      selectedMapStates.has(stateName);

    return {
      fillColor: getColor(value, breaks),
      weight: isSelected ? 2.6 : 0.9,
      opacity: 1,
      color: isSelected ? "#ffffff" : (value > 0 ? "rgba(220,235,250,0.75)" : "rgba(160,160,160,0.35)"),
      dashArray: isSelected ? "" : null,
      fillOpacity: value > 0 ? 0.85 : 0.42
    };
  }

  function createPopupHtml(countyName, stateName, d) {
    if (!d) {
      return `
        <div class="leaflet-popup-custom">
          <div class="popup-title">${escapeHtml(countyName)}</div>
          <div class="popup-subtitle">${escapeHtml(stateName)}</div>
          <div class="popup-row"><span>Beneficiaries</span><strong>No data</strong></div>
        </div>
      `;
    }

    const indicatorsSummary = [...d.indicators]
      .filter(Boolean)
      .sort()
      .map(i => `<div class="popup-bullet">• ${escapeHtml(i)}</div>`)
      .join("");

    const agenciesSummary = [...d.agencies]
      .filter(Boolean)
      .sort()
      .join(", ");

    return `
      <div class="leaflet-popup-custom">
        <div class="popup-title">${escapeHtml(countyName)}</div>
        <div class="popup-subtitle">${escapeHtml(stateName)}</div>

        <div class="popup-row">
          <span>Beneficiaries</span>
          <strong>${fmt(d.current)}</strong>
        </div>

        <div class="popup-row">
          <span>Male</span>
          <strong>${fmt(d.male)}</strong>
        </div>

        <div class="popup-row">
          <span>Female</span>
          <strong>${fmt(d.female)}</strong>
        </div>

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
    if (!foodMap || !layerGroup) return;

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

        foodMap.fitBounds(bounds, {
          padding: [45, 45],
          maxZoom: matchingLayers.length === 1 ? 8.8 : 7.6,
          animate: true,
          duration: 1.2
        });
      } else {
        foodMap.fitBounds(layerGroup.getBounds(), {
          padding: [25, 25],
          maxZoom: 6.2,
          animate: true,
          duration: 1.2
        });
      }

      setTimeout(() => foodMap.invalidateSize(), 150);
    } catch (e) {
      foodMap.setView([7.6, 30.2], 6);
    }
  }

  function renderFoodMap(rows) {
    if (!foodMap || !countyGeoJson) return;

    const countyData = groupCountyFull(rows);

    const values = Object.values(countyData)
      .map(d => Number(d.current || 0))
      .filter(v => v > 0);

    const breaks = getQuantileBreaks(values);

    if (countyLayer) {
      foodMap.removeLayer(countyLayer);
    }

    countyLayer = L.geoJSON(countyGeoJson, {
      style: feature => styleCounty(feature, countyData, breaks),

      onEachFeature: (feature, layer) => {
        const countyName = feature.properties.ADM2_EN || "Unknown";
        const stateName = feature.properties.ADM1_EN || "Unknown";
        const d = countyData[normName(countyName)];
        const popupHtml = createPopupHtml(countyName, stateName, d);

        layer.bindPopup(popupHtml, {
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
            if (countyLayer) countyLayer.resetStyle(e.target);
          }
        });
      }
    }).addTo(foodMap);

    renderMapSummary(countyData);
    autoZoomMapToFilteredData(countyData, countyLayer);

    setTimeout(() => {
      foodMap.invalidateSize();
    }, 150);
  }

  function renderMapSummary(countyData) {
    const counties = Object.values(countyData).filter(d => d.current > 0);

    setText("map-counties", fmt(counties.length));
    setText("map-beneficiaries", fmt(counties.reduce((s, d) => s + d.current, 0)));
    setText("map-male", fmt(counties.reduce((s, d) => s + d.male, 0)));
    setText("map-female", fmt(counties.reduce((s, d) => s + d.female, 0)));

    const top = counties
      .sort((a, b) => b.current - a.current)
      .slice(0, 5);

    const topEl = document.getElementById("map-top-counties");
    if (!topEl) return;

    if (!top.length) {
      topEl.innerHTML = `<div class="top-empty">No county data available</div>`;
      return;
    }

    topEl.innerHTML = top.map((d, i) => `
      <div class="top-row">
        <div class="top-rank">${i + 1}</div>
        <div class="top-name">${escapeHtml(d.county)}</div>
        <div class="top-value">${fmt(d.current)}</div>
      </div>
    `).join("");
  }

  function renderSimpleInsights(rows) {
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

    const total = rows.reduce((s, r) => s + Number(r.current || 0), 0);
    const male = rows.reduce((s, r) => s + Number(r.male || 0), 0);
    const female = rows.reduce((s, r) => s + Number(r.female || 0), 0);

    if (!rows.length || total <= 0) {
      container.innerHTML = `<div class="simple-insight-item">No records match the selected filters.</div>`;
      return;
    }

    const stateTotals = groupSum(rows, "state");
    const countyTotals = groupSum(rows, "county");
    const agencyTotals = groupSum(rows, "agency");

    const topState = Object.entries(stateTotals)
      .filter(([n, v]) => n && n !== "Unknown" && v > 0)
      .sort((a, b) => b[1] - a[1])[0];

    const topCounty = Object.entries(countyTotals)
      .filter(([n, v]) => n && n !== "Unknown" && v > 0)
      .sort((a, b) => b[1] - a[1])[0];

    const topAgency = Object.entries(agencyTotals)
      .filter(([n, v]) => n && n !== "Unknown" && v > 0)
      .sort((a, b) => b[1] - a[1])[0];

    const countiesCount = new Set(rows.map(r => r.county).filter(c => c && c !== "Unknown")).size;
    const agenciesCount = new Set(rows.map(r => r.agency).filter(a => a && a !== "Unknown")).size;
    const statesCount = new Set(rows.map(r => r.state).filter(s => s && s !== "Unknown")).size;

    const indicatorGrouped = groupIndicators(rows)
      .filter(d => d.target && d.current > 0)
      .map(d => ({
        ...d,
        pct: (d.current / d.target) * 100
      }))
      .sort((a, b) => b.pct - a.pct);

    const insightItems = [];

    if (hasCounty) {
      insightItems.push(
        `<strong>${escapeHtml(selectedCounty)}</strong> has <span class="insight-blue">${fmt(total)}</span> total reported Food Security beneficiaries in the current selection.`
      );
    } else if (hasState) {
      insightItems.push(
        `<strong>${escapeHtml(selectedState)}</strong> has <span class="insight-blue">${fmt(total)}</span> total reported Food Security beneficiaries across <strong>${fmt(countiesCount)}</strong> county/counties.`
      );
    } else if (hasAgency && hasIndicator) {
      insightItems.push(
        `<strong>${escapeHtml(selectedAgency)}</strong> reported <span class="insight-blue">${fmt(total)}</span> beneficiaries for <strong>${escapeHtml(selectedIndicator)}</strong>.`
      );
    } else if (hasAgency) {
      insightItems.push(
        `<strong>${escapeHtml(selectedAgency)}</strong> reported <span class="insight-blue">${fmt(total)}</span> total Food Security beneficiaries across selected indicators.`
      );
    } else if (hasIndicator) {
      insightItems.push(
        `<strong>${escapeHtml(selectedIndicator)}</strong> reached <span class="insight-blue">${fmt(total)}</span> reported beneficiaries.`
      );
    } else {
      insightItems.push(
        `Food Security recorded <span class="insight-blue">${fmt(total)}</span> total reported beneficiaries across all selected records.`
      );
    }

    if (hasIndicator) {
      const selectedIndicatorData = indicatorGrouped.find(d => d.indicator === selectedIndicator);
      if (selectedIndicatorData) {
        insightItems.push(
          `<strong>${escapeHtml(selectedIndicator)}</strong> achieved <span class="${selectedIndicatorData.pct >= 100 ? "insight-good" : "insight-warn"}">${selectedIndicatorData.pct.toFixed(1)}%</span> of target against <strong>${fmt(selectedIndicatorData.target)}</strong>.`
        );
      }
    } else {
      indicatorGrouped.forEach(d => {
        insightItems.push(
          `<strong>${escapeHtml(d.indicator)}</strong> reached <span class="insight-blue">${fmt(d.current)}</span>, representing <span class="${d.pct >= 100 ? "insight-good" : "insight-warn"}">${d.pct.toFixed(1)}%</span> of target.`
        );
      });
    }

    if (!hasState && topState) {
      const share = (topState[1] / total) * 100;
      insightItems.push(
        `<strong>${escapeHtml(topState[0])}</strong> is the leading state/admin area, accounting for <span class="insight-blue">${share.toFixed(1)}%</span> of selected results.`
      );
    }

    if (!hasCounty && topCounty) {
      const share = (topCounty[1] / total) * 100;
      insightItems.push(
        `<strong>${escapeHtml(topCounty[0])}</strong> is the highest county, contributing <span class="insight-blue">${share.toFixed(1)}%</span> of selected results.`
      );
    }

    if (!hasAgency && topAgency) {
      const share = (topAgency[1] / total) * 100;
      insightItems.push(
        `<strong>${escapeHtml(topAgency[0])}</strong> is the leading reporting entity, contributing <span class="insight-blue">${share.toFixed(1)}%</span> of selected results.`
      );
    }

    if (male > 0 || female > 0) {
      const femaleShare = female + male > 0 ? (female / (female + male)) * 100 : 0;
      insightItems.push(
        `Female beneficiaries account for <span class="insight-blue">${femaleShare.toFixed(1)}%</span> of reported sex-disaggregated data in the current selection.`
      );
    }

    insightItems.push(
      `Selected data covers <strong>${fmt(statesCount)}</strong> state/admin area(s), <strong>${fmt(countiesCount)}</strong> county/counties, and <strong>${fmt(agenciesCount)}</strong> reporting entity/entities.`
    );

    container.innerHTML = insightItems
      .slice(0, 6)
      .map(item => `<div class="simple-insight-item">${item}</div>`)
      .join("");
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
        indicatorMap[indicator] = { indicator, target: Number(r.target || 0), total: 0, agencies: {} };
      }

      indicatorMap[indicator].total += Number(r.current || 0);
      indicatorMap[indicator].agencies[agency] = (indicatorMap[indicator].agencies[agency] || 0) + Number(r.current || 0);
      agencies.add(agency);

      if (!indicatorMap[indicator].target && r.target) {
        indicatorMap[indicator].target = Number(r.target || 0);
      }
    });

    const indicators = Object.values(indicatorMap)
      .filter(d => d.indicator !== "Unknown" && d.total > 0 && d.target > 0)
      .sort((a, b) => (b.total / b.target) - (a.total / a.target));

    if (!indicators.length) {
      Plotly.purge("indicator-agency-chart");
      el.innerHTML = `<div class="empty-chart">No indicator achievement data available</div>`;
      return;
    }

    const agencyOrder = ["WFP", "FAO", "NGOs"];
    const agencyList = agencyOrder.filter(a => agencies.has(a));

    const agencyColors = {
      WFP: "#FFD97A",
      FAO: "#00AEEF",
      NGOs: "#2ED3B7",
      NGO: "#2ED3B7"
    };

    const yLabels = indicators.map(d => d.indicator).reverse();
    const reversedIndicators = indicators.slice().reverse();

    const traces = agencyList.map(agency => ({
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
        return [value, d.target];
      }),
      marker: {
        color: agencyColors[agency] || "#A66CFF",
        line: { color: "rgba(255,255,255,0.16)", width: 1 }
      },
      hovertemplate: `<b>${agency}</b><br>%{y}<br>Contribution: %{x:.1f}% of target<br>Current: %{customdata[0]:,}<br>Target: %{customdata[1]:,}<extra></extra>`
    }));

    const targetMarkers = {
      type: "scatter",
      mode: "markers",
      name: "Target 100%",
      y: yLabels,
      x: reversedIndicators.map(() => 100),
      marker: { symbol: "line-ns-open", size: 24, color: "#FFFFFF", line: { color: "#FFFFFF", width: 3 } },
      hovertemplate: "<b>Target</b><br>%{y}<br>100%<extra></extra>"
    };

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

    const maxAchieved = Math.max(120, ...reversedIndicators.map(d => d.target ? (d.total / d.target) * 100 : 0));

    Plotly.newPlot("indicator-agency-chart", [...traces, targetMarkers, totalLabels], {
      barmode: "stack",
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#8ba8c4", family: "Inter, sans-serif" },
      margin: { t: 22, r: 150, b: 58, l: 310 },
      bargap: 0.35,
      xaxis: { range: [0, maxAchieved * 1.12], ticksuffix: "%", gridcolor: "rgba(0,158,219,0.13)", zeroline: false, tickfont: { size: 11 }, automargin: true },
      yaxis: { automargin: true, tickfont: { size: 11 } },
      shapes: [{
        type: "line", x0: 100, x1: 100, y0: -0.5, y1: yLabels.length - 0.5,
        xref: "x", yref: "y",
        line: { color: "rgba(255,255,255,0.75)", width: 2, dash: "dot" }
      }],
      annotations: [{
        x: 100, y: yLabels.length - 0.35, xref: "x", yref: "y",
        text: "100% target", showarrow: false, font: { color: "#ffffff", size: 11 },
        xanchor: "left", yanchor: "bottom"
      }],
      legend: { orientation: "h", x: 0, y: -0.18, font: { size: 12 }, bgcolor: "rgba(0,0,0,0)" }
    }, { displayModeBar: false, responsive: true });
  }

  function getRowsForMapSelector() {
    const indicator = indicatorFilter.value || "All";
    const agency = agencyFilter.value || "All";

    return records.filter(r =>
      (indicator === "All" || r.indicator === indicator) &&
      (agency === "All" || r.agency === agency)
    );
  }

  function buildMapSelectorItems() {
    const rows = getRowsForMapSelector();
    const stateMap = {};
    const countyMap = {};

    rows.forEach(r => {
      if (r.state && r.state !== "Unknown") {
        if (!stateMap[r.state]) {
          stateMap[r.state] = { type: "State", name: r.state, state: r.state, current: 0 };
        }
        stateMap[r.state].current += Number(r.current || 0);
      }

      if (r.county && r.county !== "Unknown") {
        const key = `${r.state}||${r.county}`;
        if (!countyMap[key]) {
          countyMap[key] = { type: "County", name: r.county, state: r.state, current: 0 };
        }
        countyMap[key].current += Number(r.current || 0);
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
      const id = `${item.type}||${item.state}||${item.name}`;
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


  function setVisualView(viewName) {
    activeVisualView = viewName === "agency" ? "agency" : "map";

    viewMapBtn?.classList.toggle("active", activeVisualView === "map");
    viewAgencyRankingBtn?.classList.toggle("active", activeVisualView === "agency");

    if (viewMapBtn) viewMapBtn.setAttribute("aria-selected", activeVisualView === "map" ? "true" : "false");
    if (viewAgencyRankingBtn) viewAgencyRankingBtn.setAttribute("aria-selected", activeVisualView === "agency" ? "true" : "false");

    foodMapViewPanel?.classList.toggle("active", activeVisualView === "map");
    foodAgencyRankingPanel?.classList.toggle("active", activeVisualView === "agency");

    if (activeVisualView === "map" && foodMap) {
      setTimeout(() => foodMap.invalidateSize(), 180);
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

    const agencyColors = {
      WFP: "#FFD97A",
      FAO: "#00AEEF",
      NGOs: "#2ED3B7",
      NGO: "#2ED3B7",
      UNICEF: "#80C7E8",
      IOM: "#90CDF4",
      UNDP: "#A7F3D0",
      UNHCR: "#93C5FD"
    };

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
        color: names.map(name => agencyColors[name] || "#A66CFF"),
        line: { color: "rgba(255,255,255,0.16)", width: 1 }
      },
      text: values.map(v => fmt(v)),
      textposition: "outside",
      customdata: values.map(v => total ? (v / total) * 100 : 0),
      cliponaxis: false,
      hovertemplate: "<b>%{y}</b><br>Reported value: %{x:,}<br>Share of filtered total: %{customdata:.1f}%<extra></extra>"
    }], {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#8ba8c4", family: "Inter, sans-serif" },
      margin: { t: 20, r: 135, b: 55, l: 210 },
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

    renderKpis(rows);
    renderSimpleInsights(rows);
    renderTable(rows);
    renderIndicatorAgencyChart(rows);
    renderStackedAgencyBarChart("state-chart", rows, "state", 13);
    renderStackedAgencyBarChart("county-chart", rows, "county", 12);
    renderAgencyColorBarChart("agency-chart", groupSum(rows, "agency"), 10);
    renderAgencyRankingView(rows);
    renderGenderChart(rows);

    if (!mapInitialized) {
      await initFoodMap();
    }

    renderFoodMap(rows);
  }

  function initializeFilters() {
    setOptions(indicatorFilter, uniqueSorted(records.map(r => r.indicator)), "All");
    setOptions(agencyFilter, uniqueSorted(records.map(r => r.agency)), "All");
    setOptions(stateFilter, uniqueSorted(records.map(r => r.state)), "All");
    setOptions(countyFilter, uniqueSorted(records.map(r => r.county)), "All");

    indicatorFilter.addEventListener("change", () => renderDashboard("indicator"));
    agencyFilter.addEventListener("change", () => renderDashboard("agency"));
    stateFilter.addEventListener("change", () => {
      selectedMapStates.clear();
      selectedMapCounties.clear();
      pendingMapStates.clear();
      pendingMapCounties.clear();
      updateMapSelectionPill();
      renderDashboard("state");
    });
    countyFilter.addEventListener("change", () => {
      selectedMapStates.clear();
      selectedMapCounties.clear();
      pendingMapStates.clear();
      pendingMapCounties.clear();
      updateMapSelectionPill();
      renderDashboard("county");
    });

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

    viewMapBtn?.addEventListener("click", () => setVisualView("map"));
    viewAgencyRankingBtn?.addEventListener("click", () => setVisualView("agency"));

    resetBtn.addEventListener("click", () => {
      indicatorFilter.value = "All";
      agencyFilter.value = "All";
      stateFilter.value = "All";
      countyFilter.value = "All";
      selectedMapStates.clear();
      selectedMapCounties.clear();
      pendingMapStates.clear();
      pendingMapCounties.clear();
      updateMapSelectionPill();
      renderDashboard();
    });
  }

  function showWarning(message) {
    if (!warningBox) return;
    warningBox.textContent = message;
    warningBox.style.display = "block";
  }

  window.toggleIndicatorTable = function() {
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

  window.downloadChartPNG = function(chartId, fileName) {
    if (typeof Plotly === "undefined") return;

    const chart = document.getElementById(chartId);
    if (!chart || !chart.data) return;

    const chartWrap = chart.closest(".chart-wrap");
    const titleText = chartWrap?.querySelector(".chart-title")?.textContent?.trim() || "Food Security Chart";
    const subtitleText = chartWrap?.querySelector(".chart-subtitle")?.textContent?.trim() || "Calculated from filtered Excel records.";

    const originalLayout = chart.layout || {};
    const exportLayout = {
      ...originalLayout,
      title: {
        text: `<b>${titleText}</b><br><span style='font-size:13px;color:#8ba8c4'>${subtitleText}</span>`,
        x: 0.02, xanchor: "left", y: 0.98, yanchor: "top",
        font: { family: "Inter, sans-serif", size: 22, color: "#ffffff" }
      },
      paper_bgcolor: "#0c1f3a",
      plot_bgcolor: "#0c1f3a",
      margin: {
        ...(originalLayout.margin || {}),
        t: 110,
        r: Math.max((originalLayout.margin?.r || 80), 110),
        l: Math.max((originalLayout.margin?.l || 160), chartId === "gender-chart" ? 70 : 170),
        b: Math.max((originalLayout.margin?.b || 60), 90)
      }
    };

    Plotly.downloadImage({ data: chart.data, layout: exportLayout }, {
      format: "png", filename: fileName, height: 850, width: 1400, scale: 2
    });
  };

  window.downloadChartCSV = function(type) {
    const rows = getFilteredRecords();
    let csvRows = [];

    if (type === "state") {
      csvRows = [["State/Admin Area", "Current Number"]];
      Object.entries(groupSum(rows, "state")).filter(([n,v]) => n && n !== "Unknown" && v > 0).sort((a,b) => b[1]-a[1]).forEach(([n,v]) => csvRows.push([n,v]));
    }

    if (type === "county") {
      csvRows = [["County", "Current Number"]];
      Object.entries(groupSum(rows, "county")).filter(([n,v]) => n && n !== "Unknown" && v > 0).sort((a,b) => b[1]-a[1]).forEach(([n,v]) => csvRows.push([n,v]));
    }

    if (type === "agency") {
      csvRows = [["Reporting Entity", "Current Number"]];
      Object.entries(groupSum(rows, "agency")).filter(([n,v]) => n && n !== "Unknown" && v > 0).sort((a,b) => b[1]-a[1]).forEach(([n,v]) => csvRows.push([n,v]));
    }

    if (type === "gender") {
      csvRows = [
        ["Gender", "Number"],
        ["Male", rows.reduce((s,r) => s + r.male, 0)],
        ["Female", rows.reduce((s,r) => s + r.female, 0)]
      ];
    }

    if (type === "indicatorAgency") {
      const grouped = {};
      rows.forEach(r => {
        const key = `${r.indicator}||${r.agency}`;
        if (!grouped[key]) grouped[key] = { indicator: r.indicator, agency: r.agency, current: 0, target: Number(r.target || 0) };
        grouped[key].current += Number(r.current || 0);
        if (!grouped[key].target && r.target) grouped[key].target = Number(r.target || 0);
      });
      csvRows = [["Indicator", "Reporting Entity", "Current Number", "Target", "Achievement %"]];
      Object.values(grouped).sort((a,b) => a.indicator.localeCompare(b.indicator) || b.current - a.current).forEach(d => {
        const pct = d.target ? (d.current / d.target) * 100 : 0;
        csvRows.push([d.indicator, d.agency, d.current, d.target, pct.toFixed(1)]);
      });
    }

    if (!csvRows.length) return;
    triggerCsvDownload(`food_security_${type}_chart_data.csv`, rowsToCsv(csvRows));
  };

  initializeFilters();
  renderDashboard();

  window.addEventListener("resize", () => {
    ["state-chart", "county-chart", "indicator-agency-chart", "agency-chart", "agency-ranking-chart", "gender-chart"].forEach(id => {
      const el = document.getElementById(id);
      if (el && typeof Plotly !== "undefined") Plotly.Plots.resize(el);
    });

    if (foodMap) {
      setTimeout(() => foodMap.invalidateSize(), 150);
    }
  });
});