let map, detailMap, trackingMap;
let busMarker = null, intervalJejakBas = null;
let userLat = null, userLon = null;
let allStops = [], allRoutes = [];
let splashHidden = false;

const API_BASE = 'http://localhost:3000/api';
const API_STOPS_NEARBY = `${API_BASE}/stops/nearby`;
const API_ROUTES_ALL = `${API_BASE}/routes/all`;
const API_BUSES_REALTIME = `${API_BASE}/buses/realtime`;

const ROUTE_COLORS = ['bg-blue', 'bg-green', 'bg-purple', 'bg-orange', 'bg-cyan', 'bg-magenta', 'bg-red'];

// ── Page Loader (dipindahkan ke luar document.ready) ──
function loadPage(name) {
    // Destroy maps when leaving map/tracking pages
    if (name !== 'map') { if (map) { map.remove(); map = null; } }

    $.get(`${name}.html`, function (html) {
        $('#app-view-port').html(html);
        $.get('sub-screens.html', function (sub) {
            $('#sub-screen-container').html(sub);
            bindSubHandlers();
            hideSplash();
        }).fail(() => console.error('sub-screens.html missing'));

        if (name === 'home') loadHomeData();
        else if (name === 'map') setTimeout(initMap, 150);
        else if (name === 'routes') loadRoutesData();
        else if (name === 'favs') loadFavorites();
        else if (name === 'about') { } // static

        hideSplash();
    }).fail(() => {
        $('#app-view-port').html('<div class="text-center py-5 text-muted">Error loading page.</div>');
        hideSplash();
    });
}

function hideSplash() {
    if (!splashHidden) {
        splashHidden = true;
        $('#splash-screen').fadeOut(700, function () { $(this).remove(); });
    }
}

// ── Global navigation ──
window.navigateToPage = function (name) {
    console.log("Navigating to:", name);
    $('.nav-item').removeClass('active');
    $(`.nav-item[data-page="${name}"]`).addClass('active');
    loadPage(name);
};

$(document).ready(function () {
    setTimeout(() => {
        if (!splashHidden) hideSplash();
    }, 3000);

    // ── Nav click ──
    $(document).on('click', '.nav-item', function () {
        navigateToPage($(this).data('page'));
    });

    loadPage('home');
});

// ── Sub-screen handlers ──────────────────────────────────────────────────────
function bindSubHandlers() {
    $(document).off('click.sub')
        .on('click.sub', '#btn-home-notification', () => showSub('#sub-notification'))
        .on('click.sub', '.btn-close-notif', () => hideSub('#sub-notification'))
        .on('click.sub', '.btn-close-sub', () => hideSub('#sub-stop-detail, #sub-route-detail'))
        .on('click.sub', '.btn-close-tracking', () => {
            if (intervalJejakBas) clearInterval(intervalJejakBas);
            hideSub('#sub-live-tracking');
            showSub('#sub-route-detail');
        });
}
function showSub(sel) { $(sel).removeClass('hidden').css('display', 'flex').css('flex-direction', 'column'); }
function hideSub(sel) { $(sel).addClass('hidden').css('display', 'none'); }

// ── Tab switch for Favourites ────────────────────────────────────────────────
window.switchFavTab = function (tab) {
    if (tab === 'routes') {
        $('#tab-routes').addClass('active'); $('#tab-stops').removeClass('active');
        $('#fav-routes-panel').show(); $('#fav-stops-panel').hide();
    } else {
        $('#tab-stops').addClass('active'); $('#tab-routes').removeClass('active');
        $('#fav-stops-panel').show(); $('#fav-routes-panel').hide();
    }
};

// ── HOME DATA ────────────────────────────────────────────────────────────────
function loadHomeData() {
    // Weather
    $.ajax({
        url: 'https://api.open-meteo.com/v1/forecast?latitude=5.3302&longitude=103.1404&current_weather=true',
        timeout: 5000,
        success: d => {
            const temp = Math.round(d.current_weather.temperature);
            const code = d.current_weather.weathercode;
            const desc = weatherDesc(code);
            const icon = weatherIcon(code);
            $('#weather-temp').text(`${temp} °C`);
            $('#weather-desc').text(desc);
            $('#weather-icon-el').html(`<i class="fas ${icon}"></i>`);
        },
        error: () => $('#weather-temp').text('-- °C')
    });

    // Nearest stop via GPS
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            p => { userLat = p.coords.latitude; userLon = p.coords.longitude; loadNearestStop(userLat, userLon); },
            () => loadNearestStop(5.4054, 103.0888)
        );
    } else loadNearestStop(5.4054, 103.0888);

    loadLiveBusStatus();
    loadFavoriteRoutesHome();
}

function weatherDesc(code) {
    if (code === 0) return 'Clear Sky';
    if (code <= 3) return 'Partly Cloudy';
    if (code <= 9) return 'Foggy';
    if (code <= 19) return 'Drizzle';
    if (code <= 29) return 'Rain';
    if (code <= 39) return 'Snow';
    if (code <= 49) return 'Fog';
    if (code <= 59) return 'Drizzle';
    if (code <= 69) return 'Rain';
    if (code <= 79) return 'Snow';
    if (code <= 89) return 'Showers';
    if (code <= 99) return 'Thunderstorm';
    return 'Partly Cloudy';
}

function weatherIcon(code) {
    if (code === 0) return 'fa-sun';
    if (code <= 3) return 'fa-cloud-sun';
    if (code <= 9) return 'fa-smog';
    if (code <= 49) return 'fa-cloud';
    if (code <= 69) return 'fa-cloud-rain';
    if (code <= 79) return 'fa-snowflake';
    if (code <= 89) return 'fa-cloud-showers-heavy';
    return 'fa-bolt';
}

function loadNearestStop(lat, lon) {
    $.ajax({
        url: `${API_STOPS_NEARBY}?lat=${lat}&lon=${lon}&limit=1`,
        timeout: 10000,
        success: d => {
            if (d.stops && d.stops.length) {
                const s = d.stops[0];
                $('#near-stop-name').text(s.name);
                $('#near-stop-distance').text(s.distance_text);
                // Store for click navigation
                $('#nearest-stop-card').data('stop', s);
            }
        },
        error: () => { $('#near-stop-name').text('Bus Stop UMT'); $('#near-stop-distance').text('--'); }
    });
}

function loadLiveBusStatus() {
    console.log("Loading routes for home page...");

    // Check current time - luar waktu operasi?
    const now = new Date();
    const currentHour = now.getHours();
    const isOperatingHours = currentHour >= 6 && currentHour <= 18; // 6am - 6pm

    $.ajax({
        url: API_ROUTES_ALL,
        timeout: 15000,
        success: d => {
            console.log("Routes API response:", d);

            // Jika tiada routes dari API
            if (!d.success || !d.routes || d.routes.length === 0) {
                if (!isOperatingHours) {
                    $('#live-bus-list').html(`
                        <div class="text-center py-4" style="color:#9CA3AF;">
                            <i class="fas fa-moon mb-2" style="font-size:1.5rem;display:block;color:#F9A8D4;"></i>
                            No active buses at this hour.<br>
                            <span style="font-size:0.7rem;">Bus services operate from 6:00 AM to 6:00 PM</span>
                        </div>
                    `);
                } else {
                    $('#live-bus-list').html(`
                        <div class="text-center py-4" style="color:#9CA3AF;">
                            <i class="fas fa-bus mb-2" style="font-size:1.5rem;display:block;color:#F9A8D4;"></i>
                            No active buses right now.<br>
                            <span style="font-size:0.7rem;">Please check back during operating hours (6:00 AM - 6:00 PM)</span>
                        </div>
                    `);
                }
                return;
            }

            const routes = d.routes.slice(0, 5);
            const favIds = JSON.parse(localStorage.getItem('fav_routes_list') || '[]').map(f => f.id);

            const html = routes.map((r, i) => {
                const color = r.color || ROUTE_COLORS[i % ROUTE_COLORS.length];
                const isFav = favIds.includes(r.short_name);
                const safeName = (r.long_name || r.short_name).replace(/'/g, "\\'");

                let statusText = isOperatingHours ? "Active Route" : "Scheduled Route";
                let statusIcon = isOperatingHours ? "fa-map-pin" : "fa-clock";

                return `<div class="bus-card" onclick="openRouteDetail('${r.short_name}','${safeName}','${color}',8)" style="cursor:pointer;">
                    <div class="bus-badge-pill ${color}">${r.short_name}</div>
                    <div class="bus-card-route">
                        <p class="route-name">${r.long_name || r.short_name}</p>
                        <p class="route-sub"><i class="fas ${statusIcon} me-1"></i>${statusText}</p>
                    </div>
                    <button class="fav-toggle-btn ${isFav ? 'active' : ''}" style="background:transparent;border:none;" onclick="event.stopPropagation(); toggleFavRoute('${r.short_name}','${safeName}','${color}')">
                        <i class="fas fa-heart" style="font-size:1rem;${isFav ? 'color:#BE185D' : 'color:#9CA3AF'}"></i>
                    </button>
                </div>`;
            }).join('');

            $('#live-bus-list').html(html);
        },
        error: (err) => {
            console.error("Routes API error:", err);
            if (!isOperatingHours) {
                $('#live-bus-list').html(`
                    <div class="text-center py-4" style="color:#9CA3AF;">
                        <i class="fas fa-moon mb-2" style="font-size:1.5rem;display:block;color:#F9A8D4;"></i>
                        Bus services end at 6:00 PM.<br>
                        <span style="font-size:0.7rem;">Please check back tomorrow from 6:00 AM</span>
                    </div>
                `);
            } else {
                $('#live-bus-list').html(`
                    <div class="text-center py-4 text-danger" style="font-size:0.82rem;">
                        <i class="fas fa-exclamation-triangle me-2"></i>
                        Unable to load bus data. Please check your connection.
                    </div>
                `);
            }
        }
    });
}

function busCardHtml(code, color, name, sub, time, label, routeCode, routeName, routeColor) {
    const safeCode = (routeCode || code || '').replace(/'/g, "\\'");
    const safeName = (routeName || name || '').replace(/'/g, "\\'");
    const safeColor = (routeColor || color || '');
    return `<div class="bus-card" onclick="openRouteDetail('${safeCode}','${safeName}','${safeColor}',8)" style="cursor:pointer;">
        <div class="bus-badge-pill ${color}">${code}</div>
        <div class="bus-card-route">
            <p class="route-name">${name}</p>
            <p class="route-sub">${sub}</p>
        </div>
        <div class="bus-card-eta">
            <div class="eta-time">${time}</div>
            <div class="eta-label">${label}</div>
        </div>
    </div>`;
}

function loadFavoriteRoutesHome() {
    let favs = JSON.parse(localStorage.getItem('fav_routes_list') || '[]');

    // Jika TIADA favourite routes, jangan tunjuk apa-apa
    if (!favs.length) {
        $('#home-fav-routes-list').html('');  // Kosongkan terus
        $('#home-fav-routes-list').parent().hide();  // Sembunyi kan section
        return;
    }

    $('#home-fav-routes-list').html(favs.slice(0, 5).map(r => {
        const safeId = r.id.replace(/'/g, "\\'");
        const safeName = r.nama.replace(/'/g, "\\'");
        return `<div class="fav-chip" onclick="openRouteDetail('${safeId}','${safeName}','${r.warna}',8)" style="cursor:pointer;">
            <span class="chip-badge ${r.warna}">${r.id}</span>
            <span class="chip-name">${r.nama}</span>
        </div>`;
    }).join(''));
}

// ── MAP PAGE ─────────────────────────────────────────────────────────────────
function initMap() {
    if (typeof L === 'undefined') return;
    const lat0 = 5.4054, lon0 = 103.0888;
    map = L.map('map', { zoomControl: false }).setView([lat0, lon0], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM' }).addTo(map);

    const gps = (pos) => {
        userLat = pos.coords.latitude; userLon = pos.coords.longitude;
        L.circleMarker([userLat, userLon], { radius: 7, color: '#BE185D', fillColor: '#F472B6', fillOpacity: 0.9 }).addTo(map);
        map.setView([userLat, userLon], 15);
        loadStopsFromAPI(userLat, userLon);
    };
    navigator.geolocation ? navigator.geolocation.getCurrentPosition(gps, () => loadStopsFromAPI(lat0, lon0))
        : loadStopsFromAPI(lat0, lon0);

    $(document).off('input.stopSearch').on('input.stopSearch', '#stop-search', function () {
        const q = $(this).val().toLowerCase();
        const filtered = allStops.filter(s => s.name.toLowerCase().includes(q));
        renderStopList(filtered);
    });
}

function loadStopsFromAPI(lat, lon) {
    $('#stop-list-container').html('<div class="text-center py-4" style="color:#9CA3AF;font-size:0.82rem;"><i class="fas fa-spinner fa-pulse me-2"></i>Loading bus stops...</div>');
    $.ajax({
        url: `${API_STOPS_NEARBY}?lat=${lat}&lon=${lon}&limit=25`,
        timeout: 15000,
        success: d => {
            if (d.stops && d.stops.length) {
                allStops = d.stops;
                allStops.forEach(s => {
                    L.marker([s.latitude, s.longitude], {
                        icon: L.divIcon({ html: '<div style="background:#BE185D;width:10px;height:10px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>', iconSize: [10, 10] })
                    }).addTo(map).on('click', () => openStopDetail(s.name, s.distance_text, s.latitude, s.longitude, s.id));
                });
                renderStopList(allStops);
                if (map) map.invalidateSize();
            } else {
                $('#stop-list-container').html('<div class="text-center py-4" style="color:#9CA3AF;font-size:0.82rem;">No stops found nearby.</div>');
            }
        },
        error: () => $('#stop-list-container').html('<div class="text-center py-4 text-danger" style="font-size:0.82rem;"><i class="fas fa-exclamation-triangle me-2"></i>Unable to load stops.</div>')
    });
}

function renderStopList(stops) {
    if (!stops.length) {
        $('#stop-list-container').html('<div class="text-center py-4" style="color:#9CA3AF;font-size:0.82rem;">No stops found.</div>');
        return;
    }
    $('#stop-list-container').html(stops.map(s => `
        <div class="stop-row" onclick="openStopDetail('${s.name.replace(/'/g, "\\'")}','${s.distance_text}',${s.latitude},${s.longitude},'${s.id}')">
            <div class="stop-dot"><i class="fas fa-bus"></i></div>
            <div class="flex-grow-1">
                <p class="stop-row-name">${s.name}</p>
                <p class="stop-row-dist"><i class="fas fa-person-walking me-1"></i>${s.distance_text}</p>
            </div>
            <i class="fas fa-chevron-right stop-row-arrow"></i>
        </div>`).join(''));
}

// ── STOP DETAIL ──────────────────────────────────────────────────────────────
window.openStopDetail = function (name, distance, lat, lon, stopId) {
    $('#detail-stop-name').text(name);
    $('#detail-stop-distance').text(distance);
    $('#detail-stop-address').text(`${name}, Kuala Terengganu`);
    showSub('#sub-stop-detail');

    setTimeout(() => {
        if (typeof L === 'undefined') return;
        if (!detailMap) {
            detailMap = L.map('detail-mini-map', { zoomControl: false, attributionControl: false }).setView([lat, lon], 16);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(detailMap);
        } else detailMap.setView([lat, lon], 16);
        L.marker([lat, lon]).addTo(detailMap);
        detailMap.invalidateSize();
    }, 250);

    $('#upcoming-bus-list').html('<div class="text-center py-3" style="color:#9CA3AF;font-size:0.82rem;"><i class="fas fa-spinner fa-pulse me-2"></i>Loading buses...</div>');

    $.when(
        $.ajax({ url: API_BUSES_REALTIME, timeout: 10000 }),
        $.ajax({ url: API_ROUTES_ALL, timeout: 15000 })
    ).done(function (realtimeRes, routesRes) {
        const busData = realtimeRes[0];
        const routesData = routesRes[0];

        const routeMap = {};
        if (routesData.success && routesData.routes) {
            routesData.routes.forEach((r, i) => {
                routeMap[r.id] = { name: r.long_name, short: r.short_name, color: r.color || ROUTE_COLORS[i % ROUTE_COLORS.length] };
            });
        }

        // Check operating hours
        const now = new Date();
        const currentHour = now.getHours();
        const isOperatingHours = currentHour >= 6 && currentHour <= 18;

        if (busData.success && busData.vehicles && busData.vehicles.length) {
            const html = busData.vehicles.slice(0, 3).map((v, i) => {
                const rid = (v.route_id && v.route_id !== 'unknown') ? v.route_id : null;
                const info = rid && routeMap[rid] ? routeMap[rid] : null;
                const code = info ? (info.short || rid) : (rid ? rid : `Bus ${i + 1}`);
                const rname = info ? info.name : (rid ? `Route ${rid}` : 'Active Bus');
                const color = info ? info.color : ROUTE_COLORS[i % ROUTE_COLORS.length];
                return busCardHtml(code, color, rname, 'Arriving soon', `${3 + i * 2} min`, 'Arriving', code, rname, color);
            }).join('');
            $('#upcoming-bus-list').html(html);
        } else {
            // No buses available
            if (!isOperatingHours) {
                $('#upcoming-bus-list').html(`
                <div class="text-center py-4" style="color:#9CA3AF;">
                    <i class="fas fa-moon mb-2" style="font-size:1.2rem;display:block;color:#F9A8D4;"></i>
                    No upcoming buses at this hour.<br>
                    <span style="font-size:0.7rem;">Operating hours: 6:00 AM - 6:00 PM</span>
                </div>
            `);
            } else {
                $('#upcoming-bus-list').html(`
                <div class="text-center py-4" style="color:#9CA3AF;">
                    <i class="fas fa-bus mb-2" style="font-size:1.2rem;display:block;"></i>
                    No active buses for this stop right now.
                </div>
            `);
            }
        }
    }).fail(function () {
        const now = new Date();
        const currentHour = now.getHours();
        const isOperatingHours = currentHour >= 6 && currentHour <= 18;

        if (!isOperatingHours) {
            $('#upcoming-bus-list').html(`
            <div class="text-center py-4" style="color:#9CA3AF;">
                <i class="fas fa-moon mb-2" style="font-size:1.2rem;display:block;"></i>
                Bus services end at 6:00 PM.<br>
                <span style="font-size:0.7rem;">Please check back tomorrow from 6:00 AM</span>
            </div>
        `);
        } else {
            $('#upcoming-bus-list').html(`
            <div class="text-center py-3 text-danger" style="font-size:0.82rem;">
                <i class="fas fa-exclamation-triangle me-2"></i>
                Unable to load bus data.
            </div>
        `);
        }
    });

    $('#btn-sub-view-on-map-back').off('click').on('click', function () {
        hideSub('#sub-stop-detail');
        if (map) { map.panTo([lat, lon]); map.setZoom(17); }
    });
};

// ── ROUTES DATA ──────────────────────────────────────────────────────────────
function loadRoutesData() {
    $('#full-route-list-container').html('<div class="text-center py-4" style="color:#9CA3AF;font-size:0.82rem;"><i class="fas fa-spinner fa-pulse me-2"></i>Loading routes...</div>');
    $.ajax({
        url: API_ROUTES_ALL, timeout: 20000,
        success: d => {
            if (d.success && d.routes && d.routes.length) {
                allRoutes = d.routes;
                renderRouteList(allRoutes);
            } else {
                $('#full-route-list-container').html('<div class="text-center py-4 text-danger" style="font-size:0.82rem;"><i class="fas fa-exclamation-triangle me-2"></i>No routes found.</div>');
            }
        },
        error: () => $('#full-route-list-container').html('<div class="text-center py-4 text-danger" style="font-size:0.82rem;"><i class="fas fa-exclamation-triangle me-2"></i>Server offline. Start proxy on port 3000.</div>')
    });

    $(document).off('input.routeSearch').on('input.routeSearch', '#route-search-input', function () {
        const q = $(this).val().toLowerCase();
        renderRouteList(allRoutes.filter(r => r.short_name.toLowerCase().includes(q) || r.long_name.toLowerCase().includes(q)));
    });
}

function renderRouteList(routes) {
    if (!routes.length) {
        $('#full-route-list-container').html('<div class="text-center py-4" style="color:#9CA3AF;font-size:0.82rem;">No routes found.</div>');
        return;
    }
    const favIds = JSON.parse(localStorage.getItem('fav_routes_list') || '[]').map(f => f.id);
    $('#full-route-list-container').html(routes.map((r, i) => {
        const stops = Math.floor(Math.random() * 10) + 6;
        const color = r.color || ROUTE_COLORS[i % ROUTE_COLORS.length];
        const isFav = favIds.includes(r.short_name);
        const safeName = r.long_name.replace(/'/g, "\\'");
        return `<div class="route-card" onclick="openRouteDetail('${r.short_name}','${safeName}','${color}',${stops})">
            <div class="bus-badge-pill ${color}">${r.short_name}</div>
            <div class="route-info">
                <p class="route-name">${r.long_name}</p>
                <p class="route-stops"><i class="fas fa-map-pin me-1"></i>${stops} stops</p>
            </div>
            <button class="fav-toggle-btn ${isFav ? 'active' : ''}" onclick="event.stopPropagation(); toggleFavRoute('${r.short_name}','${safeName}','${color}')" title="${isFav ? 'Remove from favourites' : 'Add to favourites'}">
                <i class="fas fa-heart"></i>
            </button>
        </div>`;
    }).join(''));
}

// ── ROUTE DETAIL ─────────────────────────────────────────────────────────────
window.openRouteDetail = function (routeCode, routeName, colorClass, stopCount) {
    console.log("Opening route detail:", routeCode, routeName);

    // Set header details
    $('#detail-route-badge').attr('class', `bus-badge-pill ${colorClass}`).css({ 'font-size': '1rem', 'padding': '8px 12px' }).text(routeCode);

    // Split route name untuk origin dan destination
    const parts = routeName.split(/[➔→-]/);
    $('#detail-route-start').text((parts[0] || 'Origin').trim());
    $('#detail-route-end').text((parts[1] || routeName || 'Destination').trim());

    // Fetch REAL stops dari API
    $('#route-timeline-stops').html('<div class="text-center py-3"><i class="fas fa-spinner fa-pulse"></i> Loading stops...</div>');

    // First, get trips for this route
    $.ajax({
        url: `${API_BASE}/routes/${routeCode}/trips`,
        timeout: 10000,
        success: function (tripData) {
            if (tripData.success && tripData.trips && tripData.trips.length) {
                // Get first trip's stop times
                const firstTrip = tripData.trips[0];
                $.ajax({
                    url: `${API_BASE}/trips/${firstTrip.trip_id}/stop_times`,
                    timeout: 10000,
                    success: function (stopData) {
                        if (stopData.success && stopData.stops && stopData.stops.length) {
                            const stopsList = stopData.stops.slice(0, 12).map(stop => {
                                const stopName = stop.stop_details?.stop_name || 'Bus Stop';
                                return `<div class="tl-item"><div class="tl-dot"></div>${stopName}</div>`;
                            }).join('');
                            $('#route-timeline-stops').html(stopsList);

                            // Update stats based on real data
                            const numStops = stopData.stops.length;
                            const estimatedTime = Math.round(numStops * 2.5); // ~2.5 min per stop
                            const distance = (numStops * 0.8).toFixed(1); // ~0.8km per stop

                            $('#detail-route-distance').text(`${distance} km`);
                            $('#detail-route-eta').text(`${estimatedTime} mins`);
                        } else {
                            useFallbackStops(routeName);
                        }
                    },
                    error: function () {
                        useFallbackStops(routeName);
                    }
                });
            } else {
                useFallbackStops(routeName);
            }
        },
        error: function () {
            useFallbackStops(routeName);
        }
    });

    function useFallbackStops(routeName) {
        // Generate stops based on route name (more realistic)
        let stopsList = [];
        if (routeName.toLowerCase().includes('umt') || routeName.toLowerCase().includes('universiti')) {
            stopsList = ['UniSZA Main Gate', 'UniSZA T-Junction', 'Kampung Gong Badak', 'Mydin Mall', 'UMT Main Gate', 'UMT Bus Hub'];
        } else if (routeName.toLowerCase().includes('ktcc') || routeName.toLowerCase().includes('mall')) {
            stopsList = ['Kampung Cina', 'Pasar Payang', 'KTCC Mall', 'Pantai Batu Buruk', 'Seberang Takir'];
        } else {
            stopsList = ['Terminal Bas MBKT', 'Lapangan Terbang', 'Gong Badak', 'Tok Jembal', 'Kampung Raja'];
        }

        const html = stopsList.map(s => `<div class="tl-item"><div class="tl-dot"></div>${s}</div>`).join('');
        $('#route-timeline-stops').html(html);
        $('#detail-route-distance').text('12.5 km');
        $('#detail-route-eta').text('25 mins');
    }

    // Favourite button in header
    const favIds = JSON.parse(localStorage.getItem('fav_routes_list') || '[]').map(f => f.id);
    const isFav = favIds.includes(routeCode);
    $('#route-detail-fav-btn').removeClass('active').addClass(isFav ? 'active' : '');
    $('#route-detail-fav-btn').off('click').on('click', function () {
        toggleFavRoute(routeCode, routeName, colorClass);
        const nowFav = JSON.parse(localStorage.getItem('fav_routes_list') || '[]').map(f => f.id).includes(routeCode);
        $(this).toggleClass('active', nowFav);
    });

    showSub('#sub-route-detail');

    $('#btn-route-view-on-map').off('click').on('click', function () {
        hideSub('#sub-route-detail');
        showSub('#sub-live-tracking');
        $('#tracking-header-title').text(`Tracking ${routeCode}`);
        $('#track-badge').attr('class', `tracking-route-badge ${colorClass}`).text(routeCode);
        $('#track-route-name-text').text(routeName);
        startLiveTracking(routeCode);
    });
};

// ── LIVE TRACKING ─────────────────────────────────────────────────────────────
function startLiveTracking(routeCode) {
    setTimeout(() => {
        if (typeof L === 'undefined') return;
        if (!trackingMap) {
            trackingMap = L.map('live-tracking-map', { attributionControl: false }).setView([5.4012, 103.0785], 14);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(trackingMap);
        } else trackingMap.setView([5.4012, 103.0785], 14);
        fetchRealtimeBuses(routeCode);
        if (intervalJejakBas) clearInterval(intervalJejakBas);
        intervalJejakBas = setInterval(() => fetchRealtimeBuses(routeCode), 30000);
        trackingMap.invalidateSize();
    }, 250);
}

function fetchRealtimeBuses(routeCode) {
    const now = new Date();
    const currentHour = now.getHours();
    const isOperatingHours = currentHour >= 6 && currentHour <= 18;
    
    if (!isOperatingHours) {
        $('#track-next-stop').text('Service Ended');
        $('#track-eta').text('6:00 AM tomorrow');
        if (busMarker) trackingMap.removeLayer(busMarker);
        busMarker = null;
        return;
    }
    
    $.ajax({
        url: API_BUSES_REALTIME, 
        timeout: 10000,
        success: d => {
            if (d.success && d.vehicles) {
                const bus = d.vehicles.find(v => v.route_id === routeCode);
                if (bus && bus.latitude) { 
                    updateBusMarker(bus.latitude, bus.longitude); 
                    $('#track-next-stop').text('Moving...'); 
                    $('#track-eta').text('Arriving soon'); 
                } else {
                    updateSimulatedBus();
                    $('#track-next-stop').text('No active bus');
                    $('#track-eta').text('--');
                }
            } else {
                updateSimulatedBus();
                $('#track-next-stop').text('No realtime data');
                $('#track-eta').text('Check schedule');
            }
        },
        error: () => {
            if (!isOperatingHours) {
                $('#track-next-stop').text('Service ended');
                $('#track-eta').text('6:00 AM');
            } else {
                updateSimulatedBus();
            }
        }
    });
}

function updateBusMarker(lat, lon) {
    const icon = L.divIcon({ html: '<div style="background:#BE185D;color:white;padding:5px 7px;border-radius:10px;font-size:13px;font-weight:bold;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.25);"><i class="fas fa-bus"></i></div>', iconSize: [32, 28] });
    if (!busMarker) busMarker = L.marker([lat, lon], { icon }).addTo(trackingMap);
    else busMarker.setLatLng([lat, lon]);
    trackingMap.panTo([lat, lon]);
}

function updateSimulatedBus() {
    updateBusMarker(5.4012 + (Math.random() - 0.5) * 0.008, 103.0785 + (Math.random() - 0.5) * 0.008);
    $('#track-next-stop').text('UniSZA T-Junction');
    $('#track-eta').text('3 min');
}

// ── FAVOURITES ────────────────────────────────────────────────────────────────
function loadFavorites() {
    renderFavRoutes();

    $(document).off('input.favSearch').on('input.favSearch', '#fav-search-input', function () {
        renderFavRoutes($(this).val().toLowerCase());
    });
}

function renderFavRoutes(query) {
    let routes = JSON.parse(localStorage.getItem('fav_routes_list') || '[]');
    if (query) routes = routes.filter(r => r.id.toLowerCase().includes(query) || r.nama.toLowerCase().includes(query));

    if (!routes.length) {
        const msg = query
            ? '<div class="text-center py-5" style="color:#9CA3AF;font-size:0.82rem;"><i class="fas fa-search mb-2" style="font-size:1.5rem;display:block;"></i>No routes match your search.</div>'
            : '<div class="text-center py-5" style="color:#9CA3AF;font-size:0.82rem;"><i class="fas fa-heart-broken mb-2" style="font-size:1.5rem;display:block;color:#F9A8D4;"></i>No favourites yet.<br><span style="font-size:0.75rem;">Tap ❤️ on any route to add it here.</span></div>';
        $('#fav-routes-list-target').html(msg);
        return;
    }

    $('#fav-routes-list-target').html(routes.map(r => {
        const safeId = r.id.replace(/'/g, "\\'");
        const safeName = r.nama.replace(/'/g, "\\'");
        return `<div class="fav-route-card" onclick="openRouteDetail('${safeId}','${safeName}','${r.warna}',8)" style="cursor:pointer;">
            <div class="bus-badge-pill ${r.warna}">${r.id}</div>
            <div class="flex-grow-1" style="font-size:0.82rem;font-weight:700;color:#111827;margin-left:4px;">${r.nama}</div>
            <button class="fav-heart-btn" onclick="event.stopPropagation(); removeFavorite('${safeId}')">
                <i class="fas fa-heart"></i>
            </button>
        </div>`;
    }).join(''));
}

window.toggleFavRoute = function (id, nama, warna) {
    let routes = JSON.parse(localStorage.getItem('fav_routes_list') || '[]');
    const exists = routes.find(r => r.id === id);
    if (exists) {
        routes = routes.filter(r => r.id !== id);
    } else {
        routes.push({ id, nama, warna });
    }
    localStorage.setItem('fav_routes_list', JSON.stringify(routes));
    if ($('#full-route-list-container').length) renderRouteList(allRoutes);
    if ($('#fav-routes-list-target').length) renderFavRoutes($('#fav-search-input').val() || '');
};

window.removeFavorite = function (id) {
    let routes = JSON.parse(localStorage.getItem('fav_routes_list') || '[]');
    routes = routes.filter(r => r.id !== id);
    localStorage.setItem('fav_routes_list', JSON.stringify(routes));
    renderFavRoutes($('#fav-search-input').val() || '');
};

window.openStopDetail = window.openStopDetail;
window.openRouteDetail = window.openRouteDetail;