(function () {
  const DATA =
    (window.CO_DATA &&
      window.CO_DATA.rapidResponse &&
      window.CO_DATA.rapidResponse.records) ||
    [];

  const SOUTH_SUDAN_CENTER = [7.3, 30.2];

  const COUNTY_COORDS = {
    Uror: [8.25, 32.05],
    Ulang: [8.77, 33.15],
    Fangak: [8.15, 31.85],
    Akobo: [7.78, 33.0],
    Lainya: [4.6, 30.0],
    Torit: [4.41, 32.57],
    Panyijiar: [7.25, 30.25],
    Ayod: [8.12, 31.4],
    Lafon: [5.25, 32.35],
    "Kajo-Keji": [3.85, 31.65],
    Juba: [4.86, 31.57],
    Yei: [4.09, 30.68],
    "Bor South": [6.21, 31.56],
    Renk: [11.74, 32.8],
    Malakal: [9.53, 31.66],
    Rubkona: [9.25, 29.8],
    Pibor: [6.8, 33.13],
    Wau: [7.7, 28.0]
  };

  const CATEGORY_COLORS = {
    Conflict: "#d64161",
    "Disease outbreak": "#e0b437",
    Other: "#8e8e8e"
  };

  const CHART_BLUE = "#3BA4F7";

  let map = null;
  let markersLayer = null;
  let lastTables = {};
  let selectedMapStates = new Set();
  let selectedMapCounties = new Set();
  let mapSelectorMode = "state";
  let mapSelectorSearch = "";

  const $ = (id) => document.getElementById(id);

  function fmt(n) {
    return (Number(n) || 0).toLocaleString(undefined, {
      maximumFractionDigits: 0
    });
  }

  function fmt1(n) {
    return (Number(n) || 0).toLocaleString(undefined, {
      maximumFractionDigits: 1
    });
  }

  function uniqueValues(records, field) {
    return [...new Set(records.map((r) => r[field]).filter(Boolean))].sort();
  }

  function sum(records, field) {
    return records.reduce((acc, r) => acc + (Number(r[field]) || 0), 0);
  }

  function avg(values) {
    const nums = values.map(Number).filter((v) => !isNaN(v) && v > 0);
    if (!nums.length) return 0;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  function populateSelect(id, values, label) {
    const el = $(id);
    if (!el) return;

    const current = el.value;
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

    if ([...el.options].some((o) => o.value === current)) {
      el.value = current;
    }
  }

  function allServices(records) {
    const services = new Set();

    records.forEach((r) => {
      (r.services || []).forEach((s) => {
        if (Number(s.value || 0) > 0) services.add(s.service);
      });
    });

    return [...services].sort();
  }

  const FILTER_CONFIG = {
    "category-filter": { field: "category", label: "Shock Types" },
    "status-filter": { field: "status", label: "Statuses" },
    "agency-filter": { field: "agency", label: "Agencies" },
    "state-filter": { field: "state", label: "States/Admin Areas" },
    "county-filter": { field: "county", label: "Counties" },
    "service-filter": { field: "service", label: "Services", isService: true }
  };

  function getSelectedFilters() {
    return {
      category: $("category-filter")?.value || "All",
      status: $("status-filter")?.value || "All",
      agency: $("agency-filter")?.value || "All",
      state: $("state-filter")?.value || "All",
      county: $("county-filter")?.value || "All",
      service: $("service-filter")?.value || "All"
    };
  }


  function getBaseFiltersForMapSelector() {
    const filters = getSelectedFilters();
    filters.state = "All";
    filters.county = "All";
    return filters;
  }

  function mapSelectorMatches(record) {
    const stateOk = selectedMapStates.size === 0 || selectedMapStates.has(record.state);
    const countyOk = selectedMapCounties.size === 0 || selectedMapCounties.has(record.county);
    return stateOk && countyOk;
  }

  function mapSelectorSelectionText() {
    const stateCount = selectedMapStates.size;
    const countyCount = selectedMapCounties.size;
    if (!stateCount && !countyCount) return "No locations selected.";
    const parts = [];
    if (stateCount) parts.push(`${stateCount} state/admin area${stateCount === 1 ? "" : "s"}`);
    if (countyCount) parts.push(`${countyCount} count${countyCount === 1 ? "y" : "ies"}`);
    return `Selected: ${parts.join(" and ")}.`;
  }

  function updateMapSelectorButtonLabel() {
    const btn = $("open-map-selector");
    if (!btn) return;
    const total = selectedMapStates.size + selectedMapCounties.size;
    btn.textContent = total ? `✎ Selected locations (${total})` : "✎ Select states / counties";
  }

  function recordHasService(record, serviceName) {
    return (
      serviceName === "All" ||
      (record.services || []).some(
        (s) => s.service === serviceName && Number(s.value || 0) > 0
      )
    );
  }

  function recordMatchesFilters(record, filters, skipKey = null) {
    return (
      (skipKey === "category" || filters.category === "All" || record.category === filters.category) &&
      (skipKey === "status" || filters.status === "All" || record.status === filters.status) &&
      (skipKey === "agency" || filters.agency === "All" || record.agency === filters.agency) &&
      (skipKey === "state" || filters.state === "All" || record.state === filters.state) &&
      (skipKey === "county" || filters.county === "All" || record.county === filters.county) &&
      (skipKey === "service" || recordHasService(record, filters.service))
    );
  }

  function serviceValuesForRecords(records) {
    const services = new Set();
    records.forEach((r) => {
      (r.services || []).forEach((s) => {
        if (Number(s.value || 0) > 0) services.add(s.service);
      });
    });
    return [...services].sort();
  }

  function optionValuesForFilter(filterId, baseFilters) {
    const config = FILTER_CONFIG[filterId];
    const skipKey = config.isService ? "service" : config.field;
    const eligible = DATA.filter((r) => recordMatchesFilters(r, baseFilters, skipKey));

    if (config.isService) return serviceValuesForRecords(eligible);
    return uniqueValues(eligible, config.field);
  }

  function updateFilterOptions(changedFilterId = null) {
    const filters = getSelectedFilters();

    Object.keys(FILTER_CONFIG).forEach((filterId) => {
      const config = FILTER_CONFIG[filterId];
      const values = optionValuesForFilter(filterId, filters);
      populateSelect(filterId, values, config.label);
    });

    // If a selected value became invalid after another filter changed, refresh once using the cleaned selections.
    const cleaned = getSelectedFilters();
    const changed = Object.keys(filters).some((key) => filters[key] !== cleaned[key]);
    if (changed) {
      Object.keys(FILTER_CONFIG).forEach((filterId) => {
        const config = FILTER_CONFIG[filterId];
        const values = optionValuesForFilter(filterId, cleaned);
        populateSelect(filterId, values, config.label);
      });
    }
  }


  function openMapSelector() {
    const drawer = $("map-selector-drawer");
    const backdrop = $("map-selector-backdrop");
    if (drawer) {
      drawer.classList.add("open");
      drawer.setAttribute("aria-hidden", "false");
    }
    if (backdrop) backdrop.classList.add("open");
    renderMapSelectorList();
  }

  function closeMapSelector() {
    const drawer = $("map-selector-drawer");
    const backdrop = $("map-selector-backdrop");
    if (drawer) {
      drawer.classList.remove("open");
      drawer.setAttribute("aria-hidden", "true");
    }
    if (backdrop) backdrop.classList.remove("open");
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
    const openBtn = $("open-map-selector");
    const closeBtn = $("close-map-selector");
    const backdrop = $("map-selector-backdrop");
    const applyBtn = $("apply-map-selector");
    const clearBtn = $("clear-map-selector");
    const search = $("map-selector-search");
    const statesTab = $("map-selector-states-tab");
    const countiesTab = $("map-selector-counties-tab");

    if (openBtn) openBtn.addEventListener("click", openMapSelector);
    if (closeBtn) closeBtn.addEventListener("click", closeMapSelector);
    if (backdrop) backdrop.addEventListener("click", closeMapSelector);
    if (applyBtn) applyBtn.addEventListener("click", closeMapSelector);

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        selectedMapStates.clear();
        selectedMapCounties.clear();
        updateMapSelectorButtonLabel();
        renderMapSelectorList();
        updateDashboard();
      });
    }

    if (search) {
      search.addEventListener("input", () => {
        mapSelectorSearch = search.value || "";
        renderMapSelectorList();
      });
    }

    if (statesTab) {
      statesTab.addEventListener("click", () => {
        mapSelectorMode = "state";
        statesTab.classList.add("active");
        if (countiesTab) countiesTab.classList.remove("active");
        renderMapSelectorList();
      });
    }

    if (countiesTab) {
      countiesTab.addEventListener("click", () => {
        mapSelectorMode = "county";
        countiesTab.classList.add("active");
        if (statesTab) statesTab.classList.remove("active");
        renderMapSelectorList();
      });
    }

    updateMapSelectorButtonLabel();
    renderMapSelectorList();
  }

  function mapSelectorBaseRecords() {
    const filters = getBaseFiltersForMapSelector();
    return DATA.filter((r) => recordMatchesFilters(r, filters));
  }

  function buildMapSelectorRows() {
    const base = mapSelectorBaseRecords();
    const grouped = {};
    const field = mapSelectorMode === "state" ? "state" : "county";

    base.forEach((r) => {
      const name = r[field] || "Not specified";
      if (!name || name === "Not specified") return;
      if (!grouped[name]) grouped[name] = { name, value: 0, responses: 0, parent: mapSelectorMode === "county" ? (r.state || "") : "" };
      grouped[name].value += Number(r.singleCount) || 0;
      grouped[name].responses += 1;
      if (mapSelectorMode === "county" && r.state) grouped[name].parent = r.state;
    });

    const q = mapSelectorSearch.trim().toLowerCase();
    return Object.values(grouped)
      .filter((d) => !q || d.name.toLowerCase().includes(q) || String(d.parent || "").toLowerCase().includes(q))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  }

  function renderMapSelectorList() {
    const list = $("map-selector-list");
    const status = $("map-selector-status");
    if (status) status.textContent = mapSelectorSelectionText();
    if (!list) return;

    const rows = buildMapSelectorRows();
    if (!rows.length) {
      list.innerHTML = `<div class="map-selector-empty">No matching locations found.</div>`;
      return;
    }

    const max = Math.max(...rows.map((d) => d.value), 1);
    list.innerHTML = rows.map((d) => {
      const selected = mapSelectorMode === "state" ? selectedMapStates.has(d.name) : selectedMapCounties.has(d.name);
      const width = Math.max(4, (d.value / max) * 100);
      const meta = mapSelectorMode === "county" && d.parent ? `${d.parent} · ${fmt(d.responses)} response(s)` : `${fmt(d.responses)} response(s)`;
      return `
        <label class="map-selector-row">
          <span class="map-selector-bar" style="width:${width}%"></span>
          <input type="checkbox" data-name="${String(d.name).replace(/&/g,"&amp;").replace(/"/g,"&quot;")}" ${selected ? "checked" : ""}/>
          <span><span class="map-selector-name">${d.name}</span><br><span class="map-selector-meta">${meta}</span></span>
          <span class="map-selector-value">${fmt(d.value)}</span>
        </label>
      `;
    }).join("");

    list.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const name = checkbox.getAttribute("data-name");
        const targetSet = mapSelectorMode === "state" ? selectedMapStates : selectedMapCounties;
        if (checkbox.checked) targetSet.add(name);
        else targetSet.delete(name);
        updateMapSelectorButtonLabel();
        renderMapSelectorList();
        updateDashboard();
      });
    });
  }

  function initFilters() {
    Object.keys(FILTER_CONFIG).forEach((filterId) => {
      const config = FILTER_CONFIG[filterId];
      const values = config.isService ? allServices(DATA) : uniqueValues(DATA, config.field);
      populateSelect(filterId, values, config.label);
    });

    Object.keys(FILTER_CONFIG).forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("change", onFilterChange);
    });

    const reset = $("reset-filters");
    if (reset) {
      reset.addEventListener("click", () => {
        Object.keys(FILTER_CONFIG).forEach((id) => {
          const el = $(id);
          if (el) el.value = "All";
        });

        selectedMapStates.clear();
        selectedMapCounties.clear();
        updateFilterOptions();
        updateMapSelectorButtonLabel();
        updateDashboard();
      });
    }
  }

  function onFilterChange() {
    updateFilterOptions(this.id);
    renderMapSelectorList();
    updateDashboard();
  }

  function getFilteredRecords() {
    const filters = getSelectedFilters();
    return DATA.filter((r) => recordMatchesFilters(r, filters) && mapSelectorMatches(r));
  }

  function groupSum(records, key, valueField) {
    const out = {};

    records.forEach((r) => {
      const k = r[key] || "Not specified";
      out[k] = (out[k] || 0) + (Number(r[valueField]) || 0);
    });

    return Object.entries(out)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }

  function groupCount(records, key) {
    const out = {};

    records.forEach((r) => {
      const k = r[key] || "Not specified";
      out[k] = (out[k] || 0) + 1;
    });

    return Object.entries(out)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }

  function groupSumWithCategory(records, key, valueField) {
    const out = {};

    records.forEach((r) => {
      const k = r[key] || "Not specified";

      if (!out[k]) {
        out[k] = {
          name: k,
          value: 0,
          categoryValues: {}
        };
      }

      out[k].value += Number(r[valueField]) || 0;

      const cat = r.category || "Other";
      out[k].categoryValues[cat] =
        (out[k].categoryValues[cat] || 0) + (Number(r[valueField]) || 0);
    });

    return Object.values(out)
      .map((d) => {
        const topCategory =
          Object.entries(d.categoryValues).sort((a, b) => b[1] - a[1])[0]?.[0] ||
          "Other";

        return {
          ...d,
          category: topCategory,
          color: CATEGORY_COLORS[topCategory] || CATEGORY_COLORS.Other
        };
      })
      .sort((a, b) => b.value - a.value);
  }

  function serviceSummary(records) {
    const out = {};

    records.forEach((r) => {
      (r.services || []).forEach((s) => {
        const value = Number(s.value) || 0;

        if (!out[s.service]) {
          out[s.service] = {
            service: s.service,
            responseCount: 0,
            people: 0,
            concluded: 0,
            ongoing: 0
          };
        }

        if (value > 0) {
          out[s.service].responseCount += 1;
          out[s.service].people += value;

          const status = (r.status || "").toLowerCase();
          if (status.includes("concluded")) out[s.service].concluded += 1;
          if (status.includes("ongoing")) out[s.service].ongoing += 1;
        }
      });
    });

    return Object.values(out).sort((a, b) => b.people - a.people);
  }

  function setRollingText(id, value, suffix = "") {
  const el = $(id);
  if (!el) return;

  const target = Number(String(value).replace(/,/g, ""));

  if (isNaN(target)) {
    el.textContent = value;
    return;
  }

  animateCount(el, target, suffix);
}

function animateCount(el, target, suffix = "") {
  const duration = 900;
  const startTime = performance.now();
  const startValue = 0;

  function update(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = startValue + (target - startValue) * eased;

    el.textContent = suffix === "%"
      ? `${current.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
      : current.toLocaleString(undefined, { maximumFractionDigits: suffix === "days" ? 1 : 0 });

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      el.textContent = suffix === "%"
        ? `${target.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
        : target.toLocaleString(undefined, { maximumFractionDigits: suffix === "days" ? 1 : 0 });
    }
  }

  requestAnimationFrame(update);
}

function updateKPIs(records) {
  const responses = records.length;

  const concluded = records.filter((r) =>
    (r.status || "").toLowerCase().includes("concluded")
  ).length;

  const ongoing = records.filter((r) =>
    (r.status || "").toLowerCase().includes("ongoing")
  ).length;

  const within14 = records.filter(
    (r) => Number(r.daysToRespond) > 0 && Number(r.daysToRespond) <= 14
  ).length;

  const within14Pct = responses ? (within14 / responses) * 100 : 0;

  setRollingText("kpi-states", uniqueValues(records, "state").length);
  setRollingText("kpi-counties", uniqueValues(records, "county").length);
  setRollingText("kpi-single-count", sum(records, "singleCount"));
  setRollingText("kpi-responses", responses);
  setRollingText("kpi-concluded", concluded);
  setRollingText("kpi-ongoing", ongoing);
  setRollingText("kpi-avg-days", avg(records.map((r) => r.daysToRespond)), "days");
  setRollingText("kpi-within-14", within14Pct, "%");
}

  function updateInsights(records) {
    const el = $("simple-insights-list");
    if (!el) return;

    if (!records.length) {
      el.innerHTML = `<div class="simple-insight-item">No records match the selected filters.</div>`;
      return;
    }

    const selectedShock = $("category-filter")?.value || "All";
    const selectedStatus = $("status-filter")?.value || "All";
    const selectedAgency = $("agency-filter")?.value || "All";
    const selectedState = $("state-filter")?.value || "All";
    const selectedCounty = $("county-filter")?.value || "All";
    const selectedService = $("service-filter")?.value || "All";

    const totalBeneficiaries = sum(records, "singleCount");
    const validDayRecords = records.filter((r) => {
      const d = Number(r.daysToRespond);
      return !Number.isNaN(d) && d >= 0;
    });

    const within14 = validDayRecords.filter((r) => Number(r.daysToRespond) <= 14).length;
    const within14Pct = validDayRecords.length ? (within14 / validDayRecords.length) * 100 : 0;
    const targetPct = 40;
    const targetGap = within14Pct - targetPct;
    const avgDaysValue = avg(validDayRecords.map((r) => r.daysToRespond));

    const countyRows = groupSum(records, "county", "singleCount");
    const stateRows = groupSum(records, "state", "singleCount");
    const shockRows = groupSum(records, "category", "singleCount");
    const services = serviceSummary(records).filter((d) => Number(d.people || 0) > 0);

    const topCounty = countyRows[0];
    const top3CountyTotal = countyRows.slice(0, 3).reduce((acc, d) => acc + d.value, 0);
    const top3Share = totalBeneficiaries ? (top3CountyTotal / totalBeneficiaries) * 100 : 0;

    const topService = services[0];
    const topServiceShare = topService && totalBeneficiaries ? (topService.people / totalBeneficiaries) * 100 : 0;

    const countySpeedRows = uniqueValues(records, "county")
      .map((county) => {
        const rows = records.filter((r) => r.county === county);
        const validRows = rows.filter((r) => {
          const d = Number(r.daysToRespond);
          return !Number.isNaN(d) && d >= 0;
        });
        return {
          name: county,
          value: avg(validRows.map((r) => r.daysToRespond)),
          count: validRows.length
        };
      })
      .filter((d) => d.count > 0 && d.value > 0)
      .sort((a, b) => a.value - b.value);

    const fastestCounty = countySpeedRows[0];
    const slowestCounty = countySpeedRows[countySpeedRows.length - 1];

    const ongoingRecords = records.filter((r) => (r.status || "").toLowerCase().includes("ongoing"));
    const overdueOngoing = ongoingRecords.filter((r) => Number(r.daysToRespond) > 14).length;

    const insights = [];

    if (selectedService === "All" && topService) {
      insights.push(
        `Largest service caseload is <strong>${topService.service}</strong>, with <strong>${fmt(topService.people)}</strong> people reached by service${topServiceShare ? ` (<strong>${fmt1(topServiceShare)}%</strong> of the selected single-count caseload)` : ""}.`
      );
    } else if (selectedService !== "All") {
      const selectedServiceRows = services.filter((s) => s.service === selectedService);
      const selectedServicePeople = selectedServiceRows[0]?.people || 0;
      insights.push(
        `<strong>${selectedService}</strong> accounts for <strong>${fmt(selectedServicePeople)}</strong> people reached by service under the current filters.`
      );
    }

    if (countyRows.length > 1 && topCounty) {
      insights.push(
        `Caseload concentration: the top county, <strong>${topCounty.name}</strong>, represents <strong>${fmt1((topCounty.value / totalBeneficiaries) * 100)}</strong>% of selected beneficiaries; top 3 counties represent <strong>${fmt1(top3Share)}</strong>%.`
      );
    }

    if (fastestCounty && slowestCounty && fastestCounty.name !== slowestCounty.name) {
      insights.push(
        `Response speed varies by location: fastest average response is in <strong>${fastestCounty.name}</strong> (<strong>${fmt1(fastestCounty.value)}</strong> days), while slowest is in <strong>${slowestCounty.name}</strong> (<strong>${fmt1(slowestCounty.value)}</strong> days).`
      );
    } else if (fastestCounty) {
      insights.push(
        `Average response time for the selected location is <strong>${fmt1(avgDaysValue)}</strong> days.`
      );
    }

    if (validDayRecords.length) {
      const performanceClass = targetGap >= 0 ? "insight-good" : "insight-warn";
      const direction = targetGap >= 0 ? "above" : "below";
      insights.push(
        `Timeliness performance is <span class="${performanceClass}"><strong>${fmt1(Math.abs(targetGap))}</strong> percentage points ${direction} the 40% target</span> for responses with valid response-time data.`
      );
    }

    if (selectedShock === "All" && shockRows.length > 1) {
      const topShock = shockRows[0];
      insights.push(
        `The dominant shock type by caseload is <strong>${topShock.name}</strong>, representing <strong>${fmt1((topShock.value / totalBeneficiaries) * 100)}</strong>% of selected beneficiaries.`
      );
    }

    if (selectedStatus === "All" && ongoingRecords.length) {
      insights.push(
        overdueOngoing
          ? `<strong>${fmt(overdueOngoing)}</strong> ongoing response(s) are already beyond 14 days and may require follow-up.`
          : `All ongoing responses with valid timing data are within the 14-day timeliness threshold.`
      );
    }

    if (selectedAgency !== "All") {
      const agencyCounties = uniqueValues(records, "county").length;
      const agencyServices = services.length;
      insights.push(
        `<strong>${selectedAgency}</strong> is reporting across <strong>${fmt(agencyCounties)}</strong> counties and <strong>${fmt(agencyServices)}</strong> service area(s) under the current filters.`
      );
    }

    if (selectedState !== "All" && selectedCounty === "All" && countyRows.length > 1 && topCounty) {
      insights.push(
        `Within <strong>${selectedState}</strong>, the largest selected caseload is in <strong>${topCounty.name}</strong> with <strong>${fmt(topCounty.value)}</strong> people reached.`
      );
    }

    const finalInsights = insights.slice(0, 6);

    el.innerHTML = finalInsights
      .map((text) => `<div class="simple-insight-item">${text}</div>`)
      .join("");
  }

  function initMap() {
    if (map || !$("rapid-map")) return;

    map = L.map("rapid-map", { scrollWheelZoom: false }).setView(
      SOUTH_SUDAN_CENTER,
      6
    );

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);
  }

  function updateMap(records) {
    initMap();
    if (!map || !markersLayer) return;

    markersLayer.clearLayers();

    const byCounty = {};

    records.forEach((r) => {
      const key = r.county;

      if (!byCounty[key]) {
        byCounty[key] = {
          county: r.county,
          state: r.state,
          value: 0,
          male: 0,
          female: 0,
          categories: new Set()
        };
      }

      byCounty[key].selected = selectedMapCounties.has(r.county) || selectedMapStates.has(r.state);
      byCounty[key].value += Number(r.singleCount) || 0;
      byCounty[key].male += Number(r.male) || 0;
      byCounty[key].female += Number(r.female) || 0;

      if (r.category) byCounty[key].categories.add(r.category);
    });

    const points = Object.values(byCounty).filter((d) => COUNTY_COORDS[d.county]);
    const maxValue = Math.max(...points.map((d) => d.value), 1);
    const bounds = [];

    points.forEach((d) => {
      const coords = COUNTY_COORDS[d.county];
      const mainCategory = [...d.categories][0] || "Other";
      const color = CATEGORY_COLORS[mainCategory] || CATEGORY_COLORS.Other;
      const radius = 7 + Math.sqrt(d.value / maxValue) * 28;

      const marker = L.circleMarker(coords, {
        radius,
        color: d.selected ? "#ffffff" : color,
        fillColor: color,
        fillOpacity: d.selected ? 0.88 : 0.65,
        weight: d.selected ? 3 : 1
      }).bindPopup(`
        <strong>${d.county}</strong><br/>
        State: ${d.state}<br/>
        Beneficiaries: ${fmt(d.value)}<br/>
        Male: ${fmt(d.male)}<br/>
        Female: ${fmt(d.female)}<br/>
        Shock type: ${[...d.categories].join(", ")}
      `);

      marker.addTo(markersLayer);
      bounds.push(coords);
    });

    if (bounds.length) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 7 });
    } else {
      map.setView(SOUTH_SUDAN_CENTER, 6);
    }

    if ($("map-counties"))
      $("map-counties").textContent = fmt(uniqueValues(records, "county").length);

    if ($("map-beneficiaries"))
      $("map-beneficiaries").textContent = fmt(sum(records, "singleCount"));

    if ($("map-male"))
      $("map-male").textContent = fmt(sum(records, "male"));

    if ($("map-female"))
      $("map-female").textContent = fmt(sum(records, "female"));

    const top = groupSum(records, "county", "singleCount").slice(0, 5);

    if ($("map-top-counties")) {
      $("map-top-counties").innerHTML =
        top
          .map(
            (d, i) => `
            <div class="ranked-list-item">
              <div class="ranked-left">
                <span class="rank-badge">${i + 1}</span>
                <span class="rank-name">${d.name}</span>
              </div>
              <strong class="rank-value">${fmt(d.value)}</strong>
            </div>
          `
          )
          .join("") || `<div class="ranked-list-item">No data</div>`;
    }

    const selectedCategory = $("category-filter")?.value || "All";
    const categoriesInData = [
      ...new Set(DATA.map((r) => r.category).filter(Boolean))
    ].sort();

    if ($("map-legend")) {
      $("map-legend").innerHTML = categoriesInData
        .map((cat) => {
          const color = CATEGORY_COLORS[cat] || CATEGORY_COLORS.Other;
          const active = selectedCategory === cat;

          return `
            <div class="legend-click-item ${active ? "legend-active" : ""}" data-category="${cat}">
              <span>
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:6px;"></span>
                ${cat}
              </span>
            </div>
          `;
        })
        .join("");

      document.querySelectorAll(".legend-click-item").forEach((item) => {
        item.addEventListener("click", () => {
          const category = item.getAttribute("data-category");
          const filter = $("category-filter");

          if (!filter) return;

          filter.value = filter.value === category ? "All" : category;
          updateFilterOptions("category-filter");
          updateDashboard();
        });
      });
    }
  }

  function renderServiceTable(records) {
    const rows = serviceSummary(records);
    lastTables.service = rows;

    const tbody = $("service-table");
    if (!tbody) return;

    tbody.innerHTML =
      rows
        .map(
          (r) => `
        <tr>
          <td>${r.service}</td>
          <td>${fmt(r.responseCount)}</td>
          <td>${fmt(r.people)}</td>
          <td>${fmt(r.concluded)}</td>
          <td>${fmt(r.ongoing)}</td>
        </tr>
      `
        )
        .join("") || `<tr><td colspan="5">No data</td></tr>`;
  }

  function darkPlotLayout(extra = {}) {
    return {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: {
        color: "#e8f1fa",
        family: "Inter, sans-serif",
        size: 11
      },
      xaxis: {
        gridcolor: "rgba(255,255,255,0.08)",
        zerolinecolor: "rgba(255,255,255,0.15)",
        color: "#8ba8c4"
      },
      yaxis: {
        gridcolor: "rgba(255,255,255,0.05)",
        zerolinecolor: "rgba(255,255,255,0.15)",
        color: "#8ba8c4"
      },
      showlegend: false,
      ...extra
    };
  }

  function plotBar(id, rows, orientation = "h", colorMode = "blue") {
    const el = $(id);
    if (!el || typeof Plotly === "undefined") return;

    if (!rows.length) {
      Plotly.newPlot(
        id,
        [],
        darkPlotLayout({
          title: {
            text: "No data",
            font: { color: "#e8f1fa", size: 13 }
          },
          margin: { t: 30, r: 20, b: 40, l: 120 }
        }),
        { displayModeBar: false, responsive: true }
      );
      return;
    }

    const chartRows = orientation === "h" ? [...rows].reverse() : rows;

    const colors =
      colorMode === "category"
        ? chartRows.map((d) => d.color || CATEGORY_COLORS[d.category] || CHART_BLUE)
        : CHART_BLUE;

    const trace =
      orientation === "h"
        ? {
            type: "bar",
            orientation: "h",
            y: chartRows.map((d) => d.name),
            x: chartRows.map((d) => d.value),
            text: chartRows.map((d) => fmt(d.value)),
            textposition: "auto",
            marker: { color: colors },
            hovertemplate: "%{y}<br>%{x:,}<extra></extra>"
          }
        : {
            type: "bar",
            x: chartRows.map((d) => d.name),
            y: chartRows.map((d) => d.value),
            text: chartRows.map((d) => fmt(d.value)),
            textposition: "auto",
            marker: { color: colors },
            hovertemplate: "%{x}<br>%{y:,}<extra></extra>"
          };

    Plotly.newPlot(
      id,
      [trace],
      darkPlotLayout({
        margin: {
          t: 25,
          r: 25,
          b: orientation === "h" ? 40 : 90,
          l: orientation === "h" ? 160 : 55
        },
        xaxis: {
          title: orientation === "h" ? "Beneficiaries" : "",
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
        }
      }),
      { displayModeBar: false, responsive: true }
    );
  }


  function renderAgencyRanking(records) {
    const el = $("agency-ranking-chart");
    if (!el || typeof Plotly === "undefined") return;

    const rows = groupSum(records, "agency", "singleCount")
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
          color: CHART_BLUE,
          line: { color: "rgba(255,255,255,0.16)", width: 1 }
        },
        hovertemplate:
          "<b>%{y}</b><br>" +
          "Single count beneficiaries: %{x:,}<br>" +
          "Share: %{customdata:.1f}%<extra></extra>"
      }],
      darkPlotLayout({
        margin: {
          t: 25,
          r: maxValue > 999999 ? 125 : 95,
          b: 50,
          l: 210
        },
        xaxis: {
          title: "Single Count Beneficiaries",
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

  function renderCharts(records) {
    const shock = groupSumWithCategory(records, "category", "singleCount");
    const statusCounts = groupCount(records, "status");
    const state = groupSumWithCategory(records, "state", "singleCount").slice(0, 12);
    const county = groupSumWithCategory(records, "county", "singleCount").slice(0, 12);

    lastTables.shock = shock;
    lastTables.status = statusCounts;
    lastTables.state = state;
    lastTables.county = county;
    lastTables.gender = [
      { name: "Male", value: sum(records, "male") },
      { name: "Female", value: sum(records, "female") }
    ];

    plotBar("shock-chart", shock, "h", "category");
    plotBar("status-chart", statusCounts, "h", "blue");
    plotBar("state-chart", state, "h", "category");
    plotBar("county-chart", county, "h", "category");

    const daysByState = uniqueValues(records, "state")
      .map((st) => {
        const stateRecords = records.filter((r) => r.state === st);
        const topCategory =
          groupSum(stateRecords, "category", "singleCount")[0]?.name || "Other";

        return {
          name: st,
          value: avg(stateRecords.map((r) => r.daysToRespond)),
          category: topCategory,
          color: CATEGORY_COLORS[topCategory] || CATEGORY_COLORS.Other
        };
      })
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);

    lastTables.days = daysByState;
    plotBar("response-days-chart", daysByState, "h", "category");

    if ($("gender-chart") && typeof Plotly !== "undefined") {
      Plotly.newPlot(
        "gender-chart",
        [
          {
            type: "pie",
            labels: ["Male", "Female"],
            values: [sum(records, "male"), sum(records, "female")],
            hole: 0.35,
            textinfo: "label+percent",
            marker: {
              colors: ["#60a5fa", "#f472b6"]
            },
            hovertemplate: "%{label}<br>%{value:,}<br>%{percent}<extra></extra>"
          }
        ],
        darkPlotLayout({
          margin: { t: 20, r: 20, b: 20, l: 20 },
          showlegend: true,
          legend: {
            font: { color: "#e8f1fa" }
          }
        }),
        { displayModeBar: false, responsive: true }
      );
    }
  }

  function renderRemarks(records) {
    const tbody = $("remarks-table");
    if (!tbody) return;

    const rows = records.filter((r) => r.remarks).slice(0, 50);
    lastTables.remarks = rows;

    tbody.innerHTML =
      rows
        .map(
          (r) => `
        <tr>
          <td>${r.state || ""}</td>
          <td>${r.county || ""}</td>
          <td>${r.category || ""}</td>
          <td>${r.status || ""}</td>
          <td>${fmt(r.daysToRespond)}</td>
          <td>${r.remarks || ""}</td>
        </tr>
      `
        )
        .join("") ||
      `<tr><td colspan="6">No remarks reported for selected filters.</td></tr>`;
  }

  function updateDashboard() {
    const records = getFilteredRecords();

    updateKPIs(records);
    updateInsights(records);
    updateMap(records);
    renderAgencyRanking(records);
    renderServiceTable(records);
    renderCharts(records);
    renderRemarks(records);
    renderMapSelectorList();
  }

  window.downloadChartPNG = function (chartId, filename) {
    if (typeof Plotly === "undefined") return;

    Plotly.downloadImage(chartId, {
      format: "png",
      filename: filename || chartId,
      height: 650,
      width: 1000,
      scale: 2
    });
  };

  window.downloadChartCSV = function (type) {
    const rows = lastTables[type] || [];
    if (!rows.length) return;

    let csv = "";

    if (type === "agencyRanking") {
      csv =
        "Agency,Single Count Beneficiaries\n" +
        rows
          .map((r) => `"${r.name}",${r.value}`)
          .join("\n");
    } else if (type === "service") {
      csv =
        "Service,Service Response Count,People Reached by Service,Concluded Service Responses,Ongoing Service Responses\n" +
        rows
          .map(
            (r) =>
              `"${r.service}",${r.responseCount},${r.people},${r.concluded},${r.ongoing}`
          )
          .join("\n");
    } else if (type === "remarks") {
      csv =
        "State,County,Shock Type,Status,Days to Respond,Remarks\n" +
        rows
          .map(
            (r) =>
              `"${r.state}","${r.county}","${r.category}","${r.status}",${r.daysToRespond},"${(
                r.remarks || ""
              ).replace(/"/g, '""')}"`
          )
          .join("\n");
    } else {
      csv =
        "Name,Value,Category\n" +
        rows
          .map((r) => `"${r.name}",${r.value},"${r.category || ""}"`)
          .join("\n");
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `rapid_response_${type}.csv`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  };

  document.addEventListener("DOMContentLoaded", () => {
    initFilters();
    initViewTabs();
    initMapSelector();
    initMap();
    updateDashboard();
  });
})();