/**
 * @file gtfs-worker.js
 * @description Web Worker script responsible for heavy-duty ZIP extraction and CSV parsing.
 * Operates on a separate thread to prevent UI freezing during 30MB+ data processing.
 */

// Import JSZip into the worker scope
importScripts('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');

// Listen for the start command from the main thread
self.onmessage = async function(e) {
	debugger;
    const { url, allBusLines, allStopCodes } = e.data;

    try {
        const response = await fetch(url);
        if (response.status === 403) {
            throw new Error("CORS_403");
        }
        if (!response.ok) throw new Error(`Server Error: ${response.statusText}`);

        const blob = await response.blob();
        const zip = await JSZip.loadAsync(blob);

        // Date calculations for active services
        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10).replace(/-/g, '');
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayName = days[now.getDay()];

        // Extract and parse text files
        const calendarText = await zip.file("calendar.txt").async("string");
        const calendar = parseCSV(calendarText);
        
        const calendarDatesText = await zip.file("calendar_dates.txt").async("string");
        const calendarDates = parseCSV(calendarDatesText);
        
        let activeServices = new Set(
            calendar
                .filter(row => row[dayName] === '1' && todayStr >= row.start_date && todayStr <= row.end_date)
                .map(row => row.service_id)
        );
        
        calendarDates.forEach(row => {
            if (row.date === todayStr) {
                if (row.exception_type === '1') activeServices.add(row.service_id);
                if (row.exception_type === '2') activeServices.delete(row.service_id);
            }
        });

        // Map routes
        const routesText = await zip.file("routes.txt").async("string");
        const routes = parseCSV(routesText);
        const routeIdMap = routes
            .filter(r => allBusLines.includes(r.route_short_name))
            .reduce((acc, r) => { acc[r.route_id] = r.route_short_name; return acc; }, {});

        // Map stops
        const stopsText = await zip.file("stops.txt").async("string");
        const stops = parseCSV(stopsText);
        const stopIdMap = stops
            .filter(s => allStopCodes.includes(s.stop_code))
            .reduce((acc, s) => { acc[s.stop_id] = s.stop_code; return acc; }, {});

        // Map trips
        const tripsText = await zip.file("trips.txt").async("string");
        const trips = parseCSV(tripsText);
        const validTrips = trips
            .filter(t => routeIdMap[t.route_id] && activeServices.has(t.service_id))
            .reduce((acc, t) => { acc[t.trip_id] = routeIdMap[t.route_id]; return acc; }, {});

        // Process stop times
        const stopTimesText = await zip.file("stop_times.txt").async("string");
        const stopTimesLines = stopTimesText.split(/\r?\n/);
        const stHeaders = stopTimesLines[0].split(',').map(h => h.replace(/"/g, '').trim());

        const tripIdx      = stHeaders.indexOf("trip_id");
        const stopIdx      = stHeaders.indexOf("stop_id");
        const routeIdx     = stHeaders.indexOf("route_id");
        const arrivalIdx   = stHeaders.indexOf("arrival_time");
        const timepointIdx = stHeaders.indexOf("timepoint");

        const finalSchedule = {};
        
        for (let i = 1; i < stopTimesLines.length; i++) {
            const row = stopTimesLines[i].split(',').map(v => v.replace(/"/g, '').trim());
            if (row.length < stHeaders.length) continue;

            const routeShortName = validTrips[row[tripIdx]];
            const stopCode = stopIdMap[row[stopIdx]];

            if (routeShortName && stopCode) {
                if (!finalSchedule[stopCode]) finalSchedule[stopCode] = {};
                if (!finalSchedule[stopCode][routeShortName]) finalSchedule[stopCode][routeShortName] = [];
                
                finalSchedule[stopCode][routeShortName].push({
                    time: row[arrivalIdx],
                    isTimePoint: row[timepointIdx] === '1',
                    tripId: row[tripIdx],
                    stopId: row[stopIdx],
                    routeId: row[routeIdx]
                });
            }
        }

        // 3. Send the finalized object back to the main thread
        self.postMessage({ success: true, schedule: finalSchedule });

    } catch (error) {
        self.postMessage({ success: false, error: error.message });
    }
};

/**
 * Standard CSV Parser for GTFS text files.
 * Transforms raw CSV string into an array of keyed objects.
 * * @function parseCSV
 * @param {string} text - The raw content of a .txt file from the GTFS ZIP.
 * @returns {Object[]} An array of objects where keys are CSV headers.
 */
function parseCSV(text) {
    const lines = text.split(/\r?\n/);
    const headers = lines[0].split(',').map(header => header.replace(/"/g, '').trim());
    return lines.slice(1).filter(line => line.trim()).map(line => {
        const values = line.line.split(/,(?=(?:(?:[^"]*(?:\\")?[^"]*"){2})*[^"]*$)/)
						// Split logic that ignores both commas in quotes AND escaped quotes
			.map(value => value.replace(/"/g, '').trim());
        return headers.reduce((obj, header, index) => { 
            obj[header] = values[index]; 
            return obj; 
        }, {});
    });
}