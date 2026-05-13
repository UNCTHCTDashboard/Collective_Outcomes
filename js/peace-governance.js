(function () {
  const DATA =
    (window.CO_DATA &&
      window.CO_DATA.peaceGovernance &&
      window.CO_DATA.peaceGovernance.records) ||
    [];

  const SOUTH_SUDAN_CENTER = [7.3, 30.2];

  const CHART_BLUE = "#3BA4F7";
  const CHART_GREEN = "#34d399";
  const CHART_ORANGE = "#fb923c";
  const CHART_PURPLE = "#a78bfa";
  const CHART_CYAN = "#22d3ee";
  const MALE_COLOR = "#60a5fa";
  const FEMALE_COLOR = "#f472b6";

  // Keep agency colours consistent across outcome pages.
  // New / unexpected entities use the lighter fallback palette.
  const AGENCY_COLORS = {
    IOM: "#00A3E0",
    UNDP: "#005EB8",
    UNFPA: "#EF4A81",
    UNMISS: "#80C41C",
    UNWOMEN: "#F6B331",
    "UN WOMEN": "#F6B331",
    UNICEF: "#1CABE2",
    WHO: "#6EA8FE",
    WFP: "#C7A047",
    FAO: "#7DBA3B",
    UNHCR: "#8EC5FF",
    UNESCO: "#B4A7D6",
    UNOPS: "#F4B183",
    UNODC: "#9AD0C2",
    OHCHR: "#D9A5B3"
  };
  const FALLBACK_COLORS = ["#93c5fd", "#67e8f9", "#86efac", "#fde68a", "#fdba74", "#c4b5fd", "#f9a8d4", "#99f6e4"];

  let map = null;
  let countyGeoJsonLayer = null;
  let geojsonCache = null;
  let lastTables = {};

  let selectedMapStates = new Set();
  let selectedMapCounties = new Set();

  const $ = (id) => document.getElementById(id);

  function fmt(n) {
    return (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  function fmt1(n) {
    return (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  function norm(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[–—]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function pct(current, target) {
    const c = Number(current) || 0;
    const t = Number(target) || 0;
    return t ? (c / t) * 100 : 0;
  }

  function uniqueValues(records, field) {
    return [...new Set(records.map((r) => r[field]).filter(Boolean))].sort();
  }

  function sum(records, field) {
    return records.reduce((acc, r) => acc + (Number(r[field]) || 0), 0);
  }

  function shortLabel(text, max = 34) {
    const value = String(text || "");
    if (value.length <= max) return value;
    return value.slice(0, max - 3) + "...";
  }

  function agencyColor(agency, index = 0) {
    return AGENCY_COLORS[agency] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
  }
   function setRollingText(id, value, decimals = 0, suffix = "") {
  const el = $(id);
  if (!el) return;

  const target = Number(String(value).replace(/,/g, ""));

  if (isNaN(target)) {
    el.textContent = value;
    return;
  }

  animateCount(el, target, decimals, suffix);
}

function animateCount(el, target, decimals = 0, suffix = "") {
  const duration = 900;
  const startTime = performance.now();
  const startValue = 0;

  function update(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = startValue + (target - startValue) * eased;

    el.textContent =
      current.toLocaleString(undefined, {
        maximumFractionDigits: decimals,
        minimumFractionDigits: decimals
      }) + suffix;

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      el.textContent =
        target.toLocaleString(undefined, {
          maximumFractionDigits: decimals,
          minimumFractionDigits: decimals
        }) + suffix;
    }
  }

  requestAnimationFrame(update);
}


  function mapSelectionActive() {
    return selectedMapStates.size > 0 || selectedMapCounties.size > 0;
  }

  function recordMatchesMapSelection(r) {
    if (!mapSelectionActive()) return true;
    return selectedMapStates.has(r.state) || selectedMapCounties.has(r.county);
  }

  function getRecordsForMapSelector() {
    const f = getSelectedFilters();
    return DATA.filter((r) =>
      (f.indicator === "All" || r.indicator === f.indicator) &&
      (f.agency === "All" || r.agency === f.agency)
    );
  }

  function locationGroupsForSelector() {
    const rows = getRecordsForMapSelector();
    const states = {};
    const counties = {};

    rows.forEach((r) => {
      if (r.state) {
        if (!states[r.state]) states[r.state] = { type: "State", name: r.state, parent: "", value: 0, records: 0 };
        states[r.state].value += Number(r.current) || 0;
        states[r.state].records += 1;
      }
      if (r.county) {
        if (!counties[r.county]) counties[r.county] = { type: "County", name: r.county, parent: r.state || "", value: 0, records: 0 };
        counties[r.county].value += Number(r.current) || 0;
        counties[r.county].records += 1;
      }
    });

    return [...Object.values(states), ...Object.values(counties)]
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  }

  function renderMapSelectorList() {
    const list = $("map-selector-list");
    if (!list) return;

    const search = norm($("map-selector-search")?.value || "");
    const type = $("map-selector-type")?.value || "All";
    const items = locationGroupsForSelector().filter((d) => {
      const matchesType = type === "All" || d.type === type;
      const matchesSearch = !search || norm(`${d.name} ${d.parent}`).includes(search);
      return matchesType && matchesSearch;
    });

    if (!items.length) {
      list.innerHTML = `<div class="map-selector-empty">No matching states or counties for the current filters.</div>`;
      updateMapSelectorCount();
      return;
    }

    list.innerHTML = items.map((d) => {
      const checked = d.type === "State" ? selectedMapStates.has(d.name) : selectedMapCounties.has(d.name);
      const key = `${d.type}||${String(d.name).replace(/"/g, "&quot;")}`;
      return `
        <label class="map-selector-row" data-type="${d.type}" data-name="${String(d.name).replace(/"/g, "&quot;")}">
          <input type="checkbox" ${checked ? "checked" : ""} data-key="${key}">
          <span>
            <div class="map-selector-name">${d.name}</div>
            <div class="map-selector-meta">${d.type}${d.parent ? " · " + d.parent : ""} · ${fmt(d.records)} record(s)</div>
          </span>
          <span class="map-selector-value">${fmt(d.value)}</span>
        </label>
      `;
    }).join("");

    list.querySelectorAll(".map-selector-row input").forEach((input) => {
      input.addEventListener("change", () => {
        const row = input.closest(".map-selector-row");
        const type = row?.dataset.type;
        const name = row?.dataset.name;
        if (!type || !name) return;

        const targetSet = type === "State" ? selectedMapStates : selectedMapCounties;
        if (input.checked) targetSet.add(name);
        else targetSet.delete(name);

        updateMapSelectorCount();
        updateDashboard();
      });
    });

    updateMapSelectorCount();
  }

  function updateMapSelectorCount() {
    const count = selectedMapStates.size + selectedMapCounties.size;
    const el = $("map-selector-count");
    if (el) el.textContent = `${count} selected`;
  }

  function openMapSelector() {
    $("map-selector-backdrop")?.classList.add("open");
    $("map-selector-drawer")?.classList.add("open");
    $("map-selector-drawer")?.setAttribute("aria-hidden", "false");
    renderMapSelectorList();
  }

  function closeMapSelector() {
    $("map-selector-backdrop")?.classList.remove("open");
    $("map-selector-drawer")?.classList.remove("open");
    $("map-selector-drawer")?.setAttribute("aria-hidden", "true");
  }


  function initViewTabs() {
    const mapTab = $("map-view-tab");
    const agencyTab = $("agency-ranking-tab");
    const mapPanel = $("map-view-panel");
    const agencyPanel = $("agency-ranking-panel");

    if (!mapTab || !agencyTab || !mapPanel || !agencyPanel || mapTab.dataset.ready === "1") return;
    mapTab.dataset.ready = "1";

    function activate(view) {
      const showMap = view === "map";

      mapTab.classList.toggle("active", showMap);
      agencyTab.classList.toggle("active", !showMap);
      mapPanel.classList.toggle("active", showMap);
      agencyPanel.classList.toggle("active", !showMap);

      if (showMap && map) {
        setTimeout(() => map.invalidateSize(), 180);
      }

      if (!showMap && typeof Plotly !== "undefined" && $("agency-ranking-chart")) {
        setTimeout(() => Plotly.Plots.resize($("agency-ranking-chart")), 120);
      }
    }

    mapTab.addEventListener("click", () => activate("map"));
    agencyTab.addEventListener("click", () => activate("agency"));
  }

  function initMapSelector() {
    $("open-map-selector")?.addEventListener("click", openMapSelector);
    $("close-map-selector")?.addEventListener("click", closeMapSelector);
    $("map-selector-backdrop")?.addEventListener("click", closeMapSelector);
    $("map-selector-search")?.addEventListener("input", renderMapSelectorList);
    $("map-selector-type")?.addEventListener("change", renderMapSelectorList);
    $("map-selector-clear")?.addEventListener("click", () => {
      selectedMapStates.clear();
      selectedMapCounties.clear();
      renderMapSelectorList();
      updateDashboard();
    });
  }

  function setWarning(message) {
    const el = $("data-warning");
    if (!el) return;
    el.style.display = message ? "block" : "none";
    el.textContent = message || "";
  }

  function populateSelect(id, values, label) {
    const el = $(id);
    if (!el) return;

    const current = el.value || "All";
    el.innerHTML = "";

    const all = document.createElement("option");
    all.value = "All";
    all.textContent = `All ${label}`;
    el.appendChild(all);

    values.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      el.appendChild(opt);
    });

    el.value = [...el.options].some((o) => o.value === current) ? current : "All";
  }

  function getFilterValue(id) {
    return $(id)?.value || "All";
  }

  function recordsMatchingExcept(exceptField) {
    const f = {
      indicator: getFilterValue("indicator-filter"),
      agency: getFilterValue("agency-filter"),
      state: getFilterValue("state-filter"),
      county: getFilterValue("county-filter")
    };

    return DATA.filter((r) =>
      (exceptField === "indicator" || f.indicator === "All" || r.indicator === f.indicator) &&
      (exceptField === "agency" || f.agency === "All" || r.agency === f.agency) &&
      (exceptField === "state" || f.state === "All" || r.state === f.state) &&
      (exceptField === "county" || f.county === "All" || r.county === f.county)
    );
  }

  function refreshCascadingFilters() {
    populateSelect("indicator-filter", uniqueValues(recordsMatchingExcept("indicator"), "indicator"), "Indicators");
    populateSelect("agency-filter", uniqueValues(recordsMatchingExcept("agency"), "agency"), "Agencies");
    populateSelect("state-filter", uniqueValues(recordsMatchingExcept("state"), "state"), "States/Admin Areas");
    populateSelect("county-filter", uniqueValues(recordsMatchingExcept("county"), "county"), "Counties");
  }

  function initFilters() {
    populateSelect("indicator-filter", uniqueValues(DATA, "indicator"), "Indicators");
    populateSelect("agency-filter", uniqueValues(DATA, "agency"), "Agencies");
    populateSelect("state-filter", uniqueValues(DATA, "state"), "States/Admin Areas");
    populateSelect("county-filter", uniqueValues(DATA, "county"), "Counties");

    ["indicator-filter", "agency-filter", "state-filter", "county-filter"].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("change", onFilterChange);
    });

    const reset = $("reset-filters");
    if (reset) {
      reset.addEventListener("click", () => {
        ["indicator-filter", "agency-filter", "state-filter", "county-filter"].forEach((id) => {
          const el = $(id);
          if (el) el.value = "All";
        });
        selectedMapStates.clear();
        selectedMapCounties.clear();
        refreshCascadingFilters();
        renderMapSelectorList();
        updateDashboard();
      });
    }

    refreshCascadingFilters();
  }

  function onFilterChange() {
    refreshCascadingFilters();
    renderMapSelectorList();
    updateDashboard();
  }

  function getSelectedFilters() {
    return {
      indicator: $("indicator-filter")?.value || "All",
      agency: $("agency-filter")?.value || "All",
      state: $("state-filter")?.value || "All",
      county: $("county-filter")?.value || "All"
    };
  }

  function getFilteredRecords() {
    const f = getSelectedFilters();
    return DATA.filter((r) =>
      (f.indicator === "All" || r.indicator === f.indicator) &&
      (f.agency === "All" || r.agency === f.agency) &&
      (f.state === "All" || r.state === f.state) &&
      (f.county === "All" || r.county === f.county) &&
      recordMatchesMapSelection(r)
    );
  }

  function recordsForIndicator(records, keywordRules) {
    return records.filter((r) => {
      const t = norm(r.indicator);
      return keywordRules.every((rule) => Array.isArray(rule) ? rule.some((x) => t.includes(x)) : t.includes(rule));
    });
  }

  function groupSum(records, key, valueField) {
    const out = {};
    records.forEach((r) => {
      const k = r[key] || "Not specified";
      out[k] = (out[k] || 0) + (Number(r[valueField]) || 0);
    });
    return Object.entries(out).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }

  function groupByAgency(records, valueField = "current") {
    return groupSum(records, "agency", valueField).filter((d) => d.value > 0);
  }

  function agencySummary(records, max = 4) {
    const rows = groupByAgency(records).slice(0, max);
    const total = rows.reduce((a, b) => a + b.value, 0) || sum(records, "current") || 1;
    if (!rows.length) return "Entities: No agency contribution data";
    return "Entities: " + rows.map((d) => `${d.name} ${fmt(d.value)} (${fmt1((d.value / total) * 100)}%)`).join(" · ");
  }

  function setAgencyNote(id, records) {
    const el = $(id);
    if (!el) return;
    el.textContent = agencySummary(records);
  }

  function groupIndicators(records) {
    const out = {};
    records.forEach((r) => {
      const indicator = r.indicator || "Not specified";
      if (!out[indicator]) {
        out[indicator] = { indicator, agencies: new Set(), current: 0, target: Number(r.target) || 0, byAgency: {} };
      }
      const current = Number(r.current) || 0;
      out[indicator].current += current;
      if (r.agency) {
        out[indicator].agencies.add(r.agency);
        out[indicator].byAgency[r.agency] = (out[indicator].byAgency[r.agency] || 0) + current;
      }
      if (!out[indicator].target && Number(r.target)) out[indicator].target = Number(r.target);
    });

    return Object.values(out).map((d) => ({
      indicator: d.indicator,
      agencies: [...d.agencies].sort().join(", "),
      agencyList: [...d.agencies].sort(),
      byAgency: d.byAgency,
      current: d.current,
      target: d.target,
      achieved: pct(d.current, d.target)
    })).sort((a, b) => b.current - a.current);
  }

  function groupStateGender(records, topN = 5) {
    const stateTotals = groupSum(records, "state", "current").slice(0, topN);
    return stateTotals.map((d) => {
      const stateRecords = records.filter((r) => r.state === d.name);
      return { name: d.name, value: d.value, male: sum(stateRecords, "male"), female: sum(stateRecords, "female") };
    });
  }

  function getCountyMetrics(records) {
    const f = getSelectedFilters();
    const indicatorSelected = f.indicator !== "All";
    const out = {};
    records.forEach((r) => {
      const county = r.county;
      if (!county) return;
      if (!out[county]) out[county] = { county, state: r.state, indicators: new Set(), agencies: new Set(), current: 0, records: 0 };
      if (r.indicator) out[county].indicators.add(r.indicator);
      if (r.agency) out[county].agencies.add(r.agency);
      out[county].current += Number(r.current) || 0;
      out[county].records += 1;
    });
    Object.values(out).forEach((d) => {
      d.value = indicatorSelected ? d.current : 1;
      d.coverageCount = d.indicators.size;
      d.label = indicatorSelected ? "Current number" : "Presence";
    });
    return out;
  }

  function getChoroplethColor(value, max, presenceMode = false) {
    if (!value || value <= 0) return "#2f3640";
    if (presenceMode) return "#5ab7e8";
    const ratio = value / max;
    if (ratio >= 0.80) return "#1f4e79";
    if (ratio >= 0.60) return "#2f6fae";
    if (ratio >= 0.40) return "#4f93c9";
    if (ratio >= 0.20) return "#9ccbe6";
    return "#d6e8f5";
  }

  function getCountyName(feature) {
    return feature.properties.ADM2_EN || feature.properties.County || feature.properties.county || feature.properties.NAME_2 || feature.properties.NAME || "";
  }

  function darkPlotLayout(extra = {}) {
    return {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#e8f1fa", family: "Inter, sans-serif", size: 11 },
      xaxis: { gridcolor: "rgba(255,255,255,0.08)", zerolinecolor: "rgba(255,255,255,0.15)", color: "#8ba8c4" },
      yaxis: { gridcolor: "rgba(255,255,255,0.05)", zerolinecolor: "rgba(255,255,255,0.15)", color: "#8ba8c4" },
      showlegend: false,
      ...extra
    };
  }

  function plotNoData(id) {
    if (!$(id) || typeof Plotly === "undefined") return;
    Plotly.newPlot(id, [], darkPlotLayout({ title: { text: "No data for selected filters", font: { color: "#e8f1fa", size: 13 } }, margin: { t: 35, r: 20, b: 40, l: 50 } }), { displayModeBar: false, responsive: true });
  }

  function plotBar(id, rows, orientation = "h", color = CHART_BLUE, xTitle = "Current Number") {
    if (!$(id) || typeof Plotly === "undefined") return;
    if (!rows.length) return plotNoData(id);
    const chartRows = orientation === "h" ? [...rows].reverse() : rows;
    const trace = orientation === "h" ? {
      type: "bar", orientation: "h", y: chartRows.map((d) => shortLabel(d.name, 30)), x: chartRows.map((d) => d.value), text: chartRows.map((d) => fmt(d.value)), textposition: "auto", marker: { color }, customdata: chartRows.map((d) => d.name), hovertemplate: "%{customdata}<br>%{x:,}<extra></extra>"
    } : {
      type: "bar", x: chartRows.map((d) => shortLabel(d.name, 18)), y: chartRows.map((d) => d.value), text: chartRows.map((d) => fmt(d.value)), textposition: "auto", marker: { color }, customdata: chartRows.map((d) => d.name), hovertemplate: "%{customdata}<br>%{y:,}<extra></extra>"
    };
    Plotly.newPlot(id, [trace], darkPlotLayout({ margin: { t: 25, r: 25, b: orientation === "h" ? 40 : 90, l: orientation === "h" ? 165 : 55 }, xaxis: { title: orientation === "h" ? xTitle : "", gridcolor: "rgba(255,255,255,0.08)", zerolinecolor: "rgba(255,255,255,0.15)", color: "#8ba8c4" }, yaxis: { title: "", gridcolor: "rgba(255,255,255,0.05)", zerolinecolor: "rgba(255,255,255,0.15)", color: "#8ba8c4", automargin: true } }), { displayModeBar: false, responsive: true });
  }

  function plotStackedByAgency(id, records, groupKey, topN = 5, orientation = "v", titleAxis = "Current Number") {
    if (!$(id) || typeof Plotly === "undefined") return;
    if (!records.length) return plotNoData(id);

    const groups = groupSum(records, groupKey, "current").slice(0, topN).map((d) => d.name);
    const agencies = uniqueValues(records, "agency");
    if (!groups.length || !agencies.length) return plotNoData(id);

    const totals = groups.map((g) =>
      sum(records.filter((r) => (r[groupKey] || "Not specified") === g), "current")
    );

    const traces = agencies.map((agency, idx) => {
      const vals = groups.map((g) =>
        sum(records.filter((r) => (r[groupKey] || "Not specified") === g && r.agency === agency), "current")
      );

      return orientation === "h"
        ? {
            type: "bar",
            orientation: "h",
            name: agency,
            y: [...groups].reverse().map((g) => shortLabel(g, 28)),
            x: [...vals].reverse(),
            marker: { color: agencyColor(agency, idx) },
            hovertemplate: `${agency}<br>%{y}: %{x:,}<extra></extra>`
          }
        : {
            type: "bar",
            name: agency,
            x: groups.map((g) => shortLabel(g, 16)),
            y: vals,
            marker: { color: agencyColor(agency, idx) },
            hovertemplate: `${agency}<br>%{x}: %{y:,}<extra></extra>`
          };
    });

    // Total labels on top/end of stacked bars.
    traces.push(
      orientation === "h"
        ? {
            type: "scatter",
            mode: "text",
            name: "Total",
            y: [...groups].reverse().map((g) => shortLabel(g, 28)),
            x: [...totals].reverse(),
            text: [...totals].reverse().map((v) => fmt(v)),
            textposition: "middle right",
            textfont: { color: "#e8f1fa", size: 11 },
            hoverinfo: "skip",
            showlegend: false
          }
        : {
            type: "scatter",
            mode: "text",
            name: "Total",
            x: groups.map((g) => shortLabel(g, 16)),
            y: totals,
            text: totals.map((v) => fmt(v)),
            textposition: "top center",
            textfont: { color: "#e8f1fa", size: 11 },
            hoverinfo: "skip",
            showlegend: false
          }
    );

    Plotly.newPlot(
      id,
      traces,
      darkPlotLayout({
        barmode: "stack",
        margin: { t: 32, r: orientation === "h" ? 70 : 30, b: orientation === "h" ? 50 : 90, l: orientation === "h" ? 170 : 60 },
        showlegend: true,
        legend: { orientation: "h", y: 1.16, x: 0, font: { color: "#e8f1fa", size: 10 } },
        xaxis: {
          title: orientation === "h" ? titleAxis : "",
          gridcolor: "rgba(255,255,255,0.08)",
          zerolinecolor: "rgba(255,255,255,0.15)",
          color: "#8ba8c4"
        },
        yaxis: {
          title: orientation === "h" ? "" : titleAxis,
          gridcolor: "rgba(255,255,255,0.05)",
          color: "#8ba8c4",
          automargin: true
        }
      }),
      { displayModeBar: false, responsive: true }
    );
  }

  function plotStackedGender(id, rows) {
    if (!$(id) || typeof Plotly === "undefined") return;
    if (!rows.length) return plotNoData(id);
    Plotly.newPlot(id, [
      { type: "bar", x: rows.map((d) => shortLabel(d.name, 16)), y: rows.map((d) => d.male), name: "Male", marker: { color: MALE_COLOR }, text: rows.map((d) => fmt(d.male)), textposition: "auto" },
      { type: "bar", x: rows.map((d) => shortLabel(d.name, 16)), y: rows.map((d) => d.female), name: "Female", marker: { color: FEMALE_COLOR }, text: rows.map((d) => fmt(d.female)), textposition: "auto" }
    ], darkPlotLayout({ barmode: "stack", margin: { t: 25, r: 25, b: 90, l: 55 }, showlegend: true, legend: { orientation: "h", y: 1.13, x: 0, font: { color: "#e8f1fa" } } }), { displayModeBar: false, responsive: true });
  }

   function updateKPIs(records) {
      const states = uniqueValues(records.filter((r) => !r.isAdminArea), "state").length;
      const adminAreas = uniqueValues(records.filter((r) => r.isAdminArea), "state").length;
     const indicators = groupIndicators(records);

     const below50 = indicators.filter(
       (r) => Number(r.target) > 0 && Number(r.achieved) < 50
       ).length;

    setRollingText("kpi-states", states);
    setRollingText("kpi-admin-areas", adminAreas);
    setRollingText("kpi-counties", uniqueValues(records, "county").length);
    setRollingText("kpi-agencies", uniqueValues(records, "agency").length);
    setRollingText("kpi-indicators", uniqueValues(records, "indicator").length);
    setRollingText("kpi-below-50", below50);
    }

  function updateInsights(records) {
    const el = $("simple-insights-list");
    if (!el) return;
    if (!records.length) {
      el.innerHTML = `<div class="simple-insight-item">No records match the selected filters.</div>`;
      return;
    }
    const indicators = groupIndicators(records);
    const byCounty = getCountyMetrics(records);
    const topCounty = Object.values(byCounty).sort((a, b) => b.coverageCount - a.coverageCount || b.current - a.current)[0];
    const topAgency = groupByAgency(records)[0];
    const lowIndicators = indicators.filter((r) => Number(r.target) > 0 && Number(r.achieved) < 50);
    const selected = getSelectedFilters();
    const topIndicator = [...indicators].filter((r) => Number(r.target) > 0).sort((a, b) => b.achieved - a.achieved)[0];

    const insight1 = selected.indicator === "All"
      ? `<strong>${fmt(uniqueValues(records, "county").length)}</strong> counties have Peace & Governance presence; <strong>${shortLabel(topCounty?.county || "N/A", 35)}</strong> has the broadest coverage with <strong>${fmt(topCounty?.coverageCount || 0)}</strong> reported indicator(s).`
      : `<strong>${shortLabel(selected.indicator, 60)}</strong> is reported in <strong>${fmt(uniqueValues(records, "county").length)}</strong> counties, with the highest reported value in <strong>${shortLabel(topCounty?.county || "N/A", 35)}</strong>.`;

    const insight2 = topAgency
      ? `<strong>${topAgency.name}</strong> has the largest contribution in the current filter. Contributions are shown by reporting entity in the charts below.`
      : `No reporting entity contribution is available for the current filter.`;

    const insight3 = lowIndicators.length
      ? `<strong>${fmt(lowIndicators.length)}</strong> target-linked indicator(s) are below 50%; lowest is <strong>${shortLabel(lowIndicators.sort((a,b)=>a.achieved-b.achieved)[0].indicator, 65)}</strong> at <strong>${fmt1(lowIndicators[0].achieved)}%</strong>.`
      : topIndicator
        ? `All target-linked indicators in the current filter are at or above 50%; highest is <strong>${shortLabel(topIndicator.indicator, 65)}</strong> at <strong>${fmt1(topIndicator.achieved)}%</strong>.`
        : `Target achievement cannot be calculated for this filter because no target-linked records are available.`;

    el.innerHTML = [insight1, insight2, insight3].map((x) => `<div class="simple-insight-item">${x}</div>`).join("");
  }

  function renderIndicatorTable(records) {
    const rows = groupIndicators(records);
    lastTables.indicatorTable = rows;
    const tbody = $("indicator-table");
    if (!tbody) return;
    tbody.innerHTML = rows.map((r) => `<tr><td>${r.indicator}</td><td>${r.agencies}</td><td>${fmt(r.current)}</td><td>${fmt(r.target)}</td><td>${fmt1(r.achieved)}%</td></tr>`).join("") || `<tr><td colspan="5">No data</td></tr>`;
  }

  function initMap() {
    if (map || !$("peace-map")) return;
    map = L.map("peace-map", { scrollWheelZoom: false }).setView(SOUTH_SUDAN_CENTER, 6);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap contributors &copy; CARTO" }).addTo(map);
  }

  function updateMap(records) {
    initMap();
    if (!map) return;
    const selected = getSelectedFilters();
    const presenceMode = selected.indicator === "All";
    const byCounty = getCountyMetrics(records);
    const values = Object.values(byCounty).map((d) => presenceMode ? d.coverageCount : d.current);
    const maxValue = Math.max(...values, 1);

    const renderGeo = (geojson) => {
      if (countyGeoJsonLayer) map.removeLayer(countyGeoJsonLayer);
      countyGeoJsonLayer = L.geoJSON(geojson, {
        style: function (feature) {
          const countyName = getCountyName(feature);
          const item = byCounty[countyName];
          const value = item ? (presenceMode ? 1 : item.current) : 0;
          const selectedCounty = selectedMapCounties.has(countyName);
          const selectedState = item && selectedMapStates.has(item.state);
          const isSelected = selectedCounty || selectedState;
          return { fillColor: getChoroplethColor(value, presenceMode ? 1 : maxValue, presenceMode), weight: isSelected ? 2.4 : 0.8, opacity: 1, color: isSelected ? "#ffffff" : "rgba(255,255,255,0.55)", fillOpacity: value > 0 ? 0.88 : 0.18 };
        },
        onEachFeature: function (feature, layer) {
          const countyName = getCountyName(feature) || "Unknown county";
          const item = byCounty[countyName];
          const agencies = item ? [...item.agencies].join(", ") : "No data";
          const indicators = item ? [...item.indicators].join("; ") : "No data";
          const valueLine = presenceMode ? `Presence: ${item ? "Reported" : "No data"}` : `Current number: ${fmt(item?.current || 0)}`;
          layer.bindPopup(`<strong>${countyName}</strong><br/>${valueLine}<br/>Indicators: ${fmt(item?.coverageCount || 0)}<br/>Reporting entities: ${agencies}<br/><span style="font-size:11px;color:#9fb6c8">${indicators}</span>`);
        }
      }).addTo(map);
      map.fitBounds(countyGeoJsonLayer.getBounds(), { padding: [30, 30], maxZoom: 7 });
    };

    if (geojsonCache) renderGeo(geojsonCache);
    else fetch("data/SouthSudan.json?v=20260501").then((response) => response.json()).then((geojson) => { geojsonCache = geojson; renderGeo(geojson); }).catch(() => setWarning("Could not load data/SouthSudan.json. Please confirm the county boundary file exists in the data folder."));

    if ($("map-counties")) $("map-counties").textContent = fmt(Object.keys(byCounty).length);
    if ($("map-indicators")) $("map-indicators").textContent = fmt(uniqueValues(records, "indicator").length);
    if ($("map-agencies")) $("map-agencies").textContent = fmt(uniqueValues(records, "agency").length);
    const lg = document.querySelector(".legend-muted");
    if (lg) lg.textContent = presenceMode ? "Default map = county presence. Select one indicator to shade by reported current number." : "Selected indicator map = county shading by current number.";

    const top = Object.values(byCounty).map((d) => ({ name: d.county, value: presenceMode ? d.coverageCount : d.current })).sort((a, b) => b.value - a.value).slice(0, 5);
    if ($("map-top-counties")) $("map-top-counties").innerHTML = top.map((d, i) => `<div class="ranked-list-item"><div class="ranked-left"><span class="rank-badge">${i + 1}</span><span class="rank-name">${d.name}</span></div><strong class="rank-value">${fmt(d.value)}</strong></div>`).join("") || `<div class="ranked-list-item">No data</div>`;
  }

  function renderAchievement(records) {
    const rows = groupIndicators(records).sort((a, b) => b.achieved - a.achieved);
    lastTables.indicatorAchievement = rows.map((r) => ({ name: r.indicator, value: r.achieved, current: r.current, target: r.target }));
    const id = "indicator-achievement-chart";
    if (!$(id) || typeof Plotly === "undefined") return;
    if (!rows.length) return plotNoData(id);
    const indicators = [...rows].reverse();
    const agencies = uniqueValues(records, "agency");
    const traces = agencies.map((agency, idx) => ({
      type: "bar", orientation: "h", name: agency,
      y: indicators.map((r) => shortLabel(r.indicator, 48)),
      x: indicators.map((r) => r.byAgency[agency] || 0),
      marker: { color: agencyColor(agency, idx) },
      customdata: indicators.map((r) => [r.indicator, r.current, r.target, r.achieved]),
      hovertemplate: `${agency}<br>%{customdata[0]}<br>Contribution: %{x:,}<br>Total: %{customdata[1]:,}<br>Target: %{customdata[2]:,}<br>Achieved: %{customdata[3]:.1f}%<extra></extra>`
    }));
    traces.push({
      type: "scatter", mode: "markers+text", name: "Target / % achieved",
      y: indicators.map((r) => shortLabel(r.indicator, 48)),
      x: indicators.map((r) => r.target || 0),
      text: indicators.map((r) => `${fmt1(r.achieved)}%`), textposition: "middle right",
      marker: { color: CHART_ORANGE, symbol: "diamond", size: 9 },
      hovertemplate: "Target: %{x:,}<extra></extra>"
    });
    Plotly.newPlot(id, traces, darkPlotLayout({ barmode: "stack", margin: { t: 25, r: 80, b: 50, l: 260 }, showlegend: true, legend: { orientation: "h", y: 1.12, x: 0, font: { color: "#e8f1fa", size: 10 } }, xaxis: { title: "Current number by reporting entity; diamond shows target", gridcolor: "rgba(255,255,255,0.08)", color: "#8ba8c4" }, yaxis: { automargin: true, color: "#8ba8c4" } }), { displayModeBar: false, responsive: true });
  }

  function renderIndicatorSpecificCharts(records) {
    const committees = recordsForIndicator(records, [["community peace", "peace committees", "platforms"], ["operational", "conflict mitigation"]]);
    const sgbv = recordsForIndicator(records, ["duty bearers", "sgbv"]);
    const justiceServices = recordsForIndicator(records, [["access-to-justice services", "access to justice services", "legal aid"]]);
    const justiceActors = recordsForIndicator(records, ["justice sector actors"]);
    const mobileJustice = recordsForIndicator(records, [["mobile access-to-justice", "mobile access to justice"]]);
    const civicEducation = recordsForIndicator(records, ["civic education"]);

    plotStackedByAgency("committees-chart", committees, "state", 5, "v");
    setAgencyNote("committees-agencies", committees);
    plotStackedByAgency("sgbv-chart", sgbv, "state", 5, "v");
    setAgencyNote("sgbv-agencies", sgbv);

    plotStackedByAgency("justice-services-chart", justiceServices, "state", 5, "v");
    setAgencyNote("justice-services-agencies", justiceServices);

    plotStackedByAgency("justice-actors-chart", justiceActors, "state", 5, "v");
    setAgencyNote("justice-actors-agencies", justiceActors);

    plotStackedByAgency("mobile-justice-chart", mobileJustice, "state", 5, "v");
    setAgencyNote("mobile-justice-agencies", mobileJustice);

    plotStackedByAgency("civic-education-chart", civicEducation, "state", 5, "v");
    setAgencyNote("civic-education-agencies", civicEducation);
  }


  function renderAgencyRanking(records) {
    const el = $("agency-ranking-chart");
    if (!el || typeof Plotly === "undefined") return;

    const selected = getSelectedFilters();
    const rows = groupSum(records, "agency", "current")
      .filter((d) => d.name && d.name !== "Not specified" && Number(d.value) > 0)
      .slice(0, 12)
      .reverse();

    lastTables.agencyRanking = [...rows].reverse();

    if (!rows.length) {
      Plotly.purge("agency-ranking-chart");
      el.innerHTML = `<div class="empty-chart">No agency ranking data available for the selected filters.</div>`;
      return;
    }

    const values = rows.map((d) => Number(d.value || 0));
    const total = values.reduce((a, b) => a + b, 0);
    const maxValue = Math.max(...values);
    const mixedUnitNote = selected.indicator === "All"
      ? "Mixed indicators selected"
      : selected.indicator;

    Plotly.newPlot(
      "agency-ranking-chart",
      [{
        type: "bar",
        orientation: "h",
        y: rows.map((d) => d.name),
        x: values,
        text: values.map((v) => fmt(v)),
        textposition: "outside",
        customdata: values.map((v) => total ? (v / total) * 100 : 0),
        cliponaxis: false,
        marker: {
          color: rows.map((d, i) => agencyColor(d.name, i)),
          line: { color: "rgba(255,255,255,0.16)", width: 1 }
        },
        hovertemplate:
          "<b>%{y}</b><br>" +
          "Current number: %{x:,}<br>" +
          "Share: %{customdata:.1f}%<br>" +
          mixedUnitNote.replace(/</g, "&lt;").replace(/>/g, "&gt;") +
          "<extra></extra>"
      }],
      darkPlotLayout({
        margin: {
          t: 25,
          r: maxValue > 999999 ? 125 : 95,
          b: 50,
          l: 210
        },
        xaxis: {
          title: "Current Number",
          gridcolor: "rgba(255,255,255,0.08)",
          zerolinecolor: "rgba(255,255,255,0.15)",
          color: "#8ba8c4"
        },
        yaxis: {
          title: "",
          gridcolor: "rgba(255,255,255,0.05)",
          zerolinecolor: "rgba(255,255,255,0.15)",
          color: "#8ba8c4",
          automargin: true
        },
        showlegend: false
      }),
      { displayModeBar: false, responsive: true }
    );
  }

  function renderCoverageCharts(records) {
    const id = "state-indicator-coverage-chart";
    if (!$(id) || typeof Plotly === "undefined") return;
    const states = uniqueValues(records, "state").map((state) => {
      const stateRecords = records.filter((r) => r.state === state);
      return { name: state, value: uniqueValues(stateRecords, "indicator").length };
    }).sort((a, b) => b.value - a.value).slice(0, 12).map((d) => d.name);
    const agencies = uniqueValues(records, "agency");
    lastTables.stateCoverage = states.map((s) => ({ name: s, value: uniqueValues(records.filter((r) => r.state === s), "indicator").length }));
    if (!states.length || !agencies.length) return plotNoData(id);

    const yStates = [...states].reverse();
    const traces = agencies.map((agency, idx) => ({
      type: "bar", orientation: "h", name: agency,
      y: yStates,
      x: yStates.map((state) => uniqueValues(records.filter((r) => r.state === state && r.agency === agency), "indicator").length),
      marker: { color: agencyColor(agency, idx) },
      hovertemplate: `${agency}<br>%{y}<br>Indicators reported by entity: %{x}<extra></extra>`
    }));
    Plotly.newPlot(id, traces, darkPlotLayout({ barmode: "stack", margin: { t: 25, r: 25, b: 50, l: 165 }, showlegend: true, legend: { orientation: "h", y: 1.13, x: 0, font: { color: "#e8f1fa", size: 10 } }, xaxis: { title: "# of indicator-entity contributions", gridcolor: "rgba(255,255,255,0.08)", color: "#8ba8c4" }, yaxis: { automargin: true, color: "#8ba8c4" } }), { displayModeBar: false, responsive: true });
  }

  function updateDashboard() {
    updateMapSelectorCount();
    const records = getFilteredRecords();
    updateKPIs(records);
    updateInsights(records);
    renderIndicatorTable(records);
    updateMap(records);
    renderAgencyRanking(records);
    renderAchievement(records);
    renderIndicatorSpecificCharts(records);
    renderCoverageCharts(records);
  }

  window.downloadChartPNG = function (chartId, filename) {
    if (typeof Plotly === "undefined") return;
    Plotly.downloadImage(chartId, { format: "png", filename: filename || chartId, height: 650, width: 1000, scale: 2 });
  };

  window.downloadChartCSV = function (type) {
    const rows = lastTables[type] || [];
    if (!rows.length) return;
    let csv = "";
    if (type === "agencyRanking") {
      csv = "Reporting Entity,Current Number\n" + rows.map((r) => `"${String(r.name || "").replace(/"/g, '""')}",${r.value}`).join("\n");
    } else if (type === "indicatorTable") {
      csv = "Indicator,Reporting UN Entities,Current Number,Target,Achieved %\n" + rows.map((r) => `"${String(r.indicator || "").replace(/"/g, '""')}","${String(r.agencies || "").replace(/"/g, '""')}",${r.current},${r.target},${r.achieved}`).join("\n");
    } else if (type === "indicatorAchievement") {
      csv = "Indicator,Achieved %,Current Number,Target\n" + rows.map((r) => `"${String(r.name || "").replace(/"/g, '""')}",${r.value},${r.current},${r.target}`).join("\n");
    } else {
      csv = "Name,Value\n" + rows.map((r) => `"${String(r.name || "").replace(/"/g, '""')}",${r.value}`).join("\n");
    }
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `peace_governance_${type}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  document.addEventListener("DOMContentLoaded", () => {
    if (!DATA.length) setWarning("No Peace and Governance records found. Please run generate-data-js.py and confirm the All Outputs sheet has Output = Peace and Governance.");
    initFilters();
    initViewTabs();
    initMapSelector();
    initMap();
    updateDashboard();
    renderMapSelectorList();
  });
})();
