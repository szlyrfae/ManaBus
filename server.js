const express = require('express');
const axios = require('axios');
const app = express();

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use(express.static('.'));

// Cache
const cache = new Map();
const CACHE_DURATION = 10 * 60 * 1000;

// Download ZIP dan extract fail yang diperlukan
async function getGtfsFile(filename) {
    const cacheKey = `gtfs_${filename}`;
    const cached = cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
        console.log(`Cache hit: ${filename}`);
        return cached.data;
    }

    console.log(`Downloading GTFS ZIP...`);
    const url = 'https://api.data.gov.my/gtfs-static/mybas-kuala-terengganu';
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: { 'User-Agent': 'ManaBus-App/2.0' }
    });

    console.log(`ZIP downloaded, size: ${response.data.byteLength} bytes`);

    // Extract guna built-in zlib + manual ZIP parsing
    // Guna JSZip kalau ada, kalau tak guna adm-zip, kalau tak guna manual
    let extractedFiles = {};

    try {
        // Cuba adm-zip
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(Buffer.from(response.data));
        zip.getEntries().forEach(entry => {
            if (!entry.isDirectory) {
                extractedFiles[entry.entryName] = entry.getData().toString('utf8');
                console.log(`  Extracted: ${entry.entryName}`);
            }
        });
    } catch (e1) {
        console.log('adm-zip failed:', e1.message);
        try {
            // Cuba jszip
            const JSZip = require('jszip');
            const zip = await JSZip.loadAsync(response.data);
            for (const [name, file] of Object.entries(zip.files)) {
                if (!file.dir) {
                    extractedFiles[name] = await file.async('string');
                    console.log(`  Extracted: ${name}`);
                }
            }
        } catch (e2) {
            console.log('jszip failed:', e2.message);
            throw new Error('Tidak dapat extract ZIP. Sila run: npm install adm-zip');
        }
    }

    // Cache semua fail
    for (const [name, content] of Object.entries(extractedFiles)) {
        cache.set(`gtfs_${name}`, { data: content, timestamp: Date.now() });
    }

    // Cuba exact match dulu, lepas tu partial match
    let result = cache.get(`gtfs_${filename}`);
    if (!result) {
        // Cari kalau ada subfolder prefix
        const matchKey = [...cache.keys()].find(k => k.endsWith(`/${filename}`) || k.endsWith(`\\${filename}`));
        if (matchKey) {
            result = cache.get(matchKey);
        }
    }
    if (!result) {
        console.log('Files dalam ZIP:', [...cache.keys()]);
        throw new Error(`${filename} tidak dijumpai dalam ZIP`);
    }
    return result.data;
}

// Parse CSV
function parseCSV(csv) {
    const lines = csv.split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const result = [];
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const values = [];
        let inQuote = false, current = '';
        for (const char of lines[i]) {
            if (char === '"') { inQuote = !inQuote; }
            else if (char === ',' && !inQuote) { values.push(current.trim().replace(/^"|"$/g, '')); current = ''; }
            else { current += char; }
        }
        values.push(current.trim().replace(/^"|"$/g, ''));
        const obj = {};
        headers.forEach((h, j) => obj[h] = values[j] || '');
        result.push(obj);
    }
    return result;
}

// Jarak antara 2 koordinat
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
    const dPhi = (lat2 - lat1) * Math.PI / 180;
    const dLam = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dPhi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLam / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// API: Semua route
app.get('/api/routes/all', async (req, res) => {
    try {
        const csv = await getGtfsFile('routes.txt');
        const routes = parseCSV(csv);
        const colors = ['bg-blue', 'bg-green', 'bg-purple', 'bg-magenta', 'bg-cyan'];
        const formatted = routes.map((r, i) => ({
            id: r.route_id,
            short_name: r.route_short_name,
            long_name: r.route_long_name,
            color: colors[i % colors.length],
            type: r.route_type
        }));
        res.json({ success: true, count: formatted.length, routes: formatted });
    } catch (err) {
        console.error('Routes error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Stops berdekatan
app.get('/api/stops/nearby', async (req, res) => {
    const { lat, lon, limit = 20 } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat dan lon diperlukan' });
    try {
        const csv = await getGtfsFile('stops.txt');
        const stops = parseCSV(csv);
        const userLat = parseFloat(lat), userLon = parseFloat(lon);
        const nearby = stops
            .map(s => {
                const sLat = parseFloat(s.stop_lat), sLon = parseFloat(s.stop_lon);
                const dist = calculateDistance(userLat, userLon, sLat, sLon);
                return {
                    id: s.stop_id, name: s.stop_name, code: s.stop_code,
                    latitude: sLat, longitude: sLon, distance: dist,
                    distance_text: dist > 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`
                };
            })
            .filter(s => !isNaN(s.latitude) && !isNaN(s.longitude))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, parseInt(limit));
        res.json({ success: true, stops: nearby });
    } catch (err) {
        console.error('Stops error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Trips untuk satu route
app.get('/api/routes/:routeId/trips', async (req, res) => {
    try {
        const csv = await getGtfsFile('trips.txt');
        const trips = parseCSV(csv).filter(t => t.route_id === req.params.routeId);
        res.json({ success: true, route_id: req.params.routeId, trips });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Stop times untuk satu trip
app.get('/api/trips/:tripId/stop_times', async (req, res) => {
    try {
        const [stCsv, stopsCsv] = await Promise.all([
            getGtfsFile('stop_times.txt'),
            getGtfsFile('stops.txt')
        ]);
        const stopTimes = parseCSV(stCsv)
            .filter(st => st.trip_id === req.params.tripId)
            .sort((a, b) => parseInt(a.stop_sequence) - parseInt(b.stop_sequence));
        const stopsMap = new Map(parseCSV(stopsCsv).map(s => [s.stop_id, s]));
        const enriched = stopTimes.map(st => ({ ...st, stop_details: stopsMap.get(st.stop_id) || null }));
        res.json({ success: true, trip_id: req.params.tripId, stops: enriched });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Realtime bus positions
app.get('/api/buses/realtime', async (req, res) => {
    try {
        const cached = cache.get('realtime');
        if (cached && (Date.now() - cached.timestamp) < 15000) { // cache 15 saat
            return res.json(cached.data);
        }
        const url = 'https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-kuala-terengganu';
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: { 'User-Agent': 'ManaBus-App/2.0' }
        });

        try {
            const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
            const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(response.data));
            const vehicles = feed.entity
                .map(e => e.vehicle ? {
                    vehicle_id: e.vehicle.vehicle?.id || 'unknown',
                    route_id: e.vehicle.trip?.route_id || 'unknown',
                    latitude: e.vehicle.position?.latitude || 0,
                    longitude: e.vehicle.position?.longitude || 0,
                    bearing: e.vehicle.position?.bearing || 0,
                    speed: e.vehicle.position?.speed || 0,
                    timestamp: e.vehicle.timestamp || Date.now() / 1000
                } : null)
                .filter(v => v && v.latitude !== 0);
            res.json({ success: true, source: 'realtime', count: vehicles.length, vehicles, timestamp: Date.now() });
            const responseData = { success: true, source: 'realtime', count: vehicles.length, vehicles, timestamp: Date.now() };
            cache.set('realtime', { data: responseData, timestamp: Date.now() });
            res.json(responseData);
        } catch (decodeErr) {
            res.json({ success: true, source: 'raw', data: Buffer.from(response.data).toString('base64'), timestamp: Date.now() });
        }
    } catch (err) {
        console.error('Realtime error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

const PORT = 3000;
app.listen(PORT, () => {
    console.log('========================================');
    console.log('🚌 ManaBus Proxy Server Running');
    console.log('========================================');
    console.log(`📡 Server:   http://localhost:${PORT}`);
    console.log(`🗺️  Routes:   http://localhost:${PORT}/api/routes/all`);
    console.log(`📍 Stops:    http://localhost:${PORT}/api/stops/nearby?lat=5.4054&lon=103.0888`);
    console.log(`🚎 Realtime: http://localhost:${PORT}/api/buses/realtime`);
    console.log('========================================');
});