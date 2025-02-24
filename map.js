import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// 1) Your Mapbox token
mapboxgl.accessToken = 'pk.eyJ1IjoicnNmcmVzaDE1IiwiYSI6ImNtN2lseXhpMDB1M3YyanB4cnNoYWZ0dGgifQ.DAmVKQfpgi5eA6Cm3Tarfg';

// 2) Initialize the map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18
});

let stations = [];
let allTrips = [];

map.on('load', async () => {
  //
  // STEP 2: Add bike-lane data
  //
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
  });
  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: { 'line-color': 'green', 'line-width': 3, 'line-opacity': 0.4 }
  });
  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: { 'line-color': 'green', 'line-width': 3, 'line-opacity': 0.4 }
  });

  //
  // STEP 3: Stations
  //
  const stationsData = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
  stations = stationsData.data.stations;
  console.log('Loaded Stations:', stations);

  // STEP 4.1: Load trips as date objects
  allTrips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    row => {
      row.started_at = new Date(row.started_at);
      row.ended_at   = new Date(row.ended_at);
      return row;
    }
  );
  console.log('Loaded Traffic:', allTrips);

  // 4.2: Compute arrivals/departures
  const departuresAll = d3.rollup(allTrips, v => v.length, d => d.start_station_id);
  const arrivalsAll   = d3.rollup(allTrips, v => v.length, d => d.end_station_id);

  stations = stations.map(stn => {
    const id = stn.short_name;
    stn.departures   = departuresAll.get(id) ?? 0;
    stn.arrivals     = arrivalsAll.get(id)   ?? 0;
    stn.totalTraffic = stn.departures + stn.arrivals;
    return stn;
  });

  // 4.3: Sqrt scale with smaller range
  const radiusScale = d3.scaleSqrt()
    .domain([0, d3.max(stations, d => d.totalTraffic)])
    .range([0, 12]) // <== smaller default
    .clamp(true);

  // STEP 6.1: ratio scale
  const stationFlow = d3.scaleQuantize()
    .domain([0, 1])
    .range([0, 0.5, 1]);

  const svg = d3.select('#map').select('svg');
  let circles = svg.selectAll('circle')
    .data(stations)
    .enter()
    .append('circle')
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('fill', 'steelblue')
    .attr('fill-opacity', 0.6)
    .style('--departure-ratio', d => stationFlow(d.departures / d.totalTraffic))
    .each(function(d) {
      d3.select(this)
        .append('title')
        .text(`${d.totalTraffic} trips (Departures: ${d.departures}, Arrivals: ${d.arrivals})`);
    });

  function getCoords(stn) {
    const { x, y } = map.project([+stn.lon, +stn.lat]);
    return { x, y };
  }

  function updatePositions() {
    circles
      .attr('cx', d => getCoords(d).x)
      .attr('cy', d => getCoords(d).y)
      .attr('r',  d => radiusScale(d.totalTraffic));
  }
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);
  updatePositions();

  //
  // STEP 5: Filter by time
  //
  const timeSlider   = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');

  function minutesSinceMidnight(dt) {
    return dt.getHours() * 60 + dt.getMinutes();
  }

  function formatTime(minutes) {
    if (minutes === -1) return 'Any time';
    const d = new Date();
    d.setHours(0, minutes);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function filterTripsByTime(tripsArray, timeFilter) {
    if (timeFilter === -1) return tripsArray;
    return tripsArray.filter(trp => {
      const s = minutesSinceMidnight(trp.started_at);
      const e = minutesSinceMidnight(trp.ended_at);
      return (Math.abs(s - timeFilter) <= 60) || (Math.abs(e - timeFilter) <= 60);
    });
  }

  function recomputeStationsByTime(timeFilter) {
    const filtered = filterTripsByTime(allTrips, timeFilter);
    const depF = d3.rollup(filtered, v => v.length, d => d.start_station_id);
    const arrF = d3.rollup(filtered, v => v.length, d => d.end_station_id);
    stations.forEach(stn => {
      const id = stn.short_name;
      stn.departures   = depF.get(id) ?? 0;
      stn.arrivals     = arrF.get(id) ?? 0;
      stn.totalTraffic = stn.departures + stn.arrivals;
    });
  }

  function updateScatterPlot(timeVal) {
    // Recompute traffic
    recomputeStationsByTime(timeVal);

    // Adjust circle range
    const maxTraffic = d3.max(stations, d => d.totalTraffic) || 0;
    if (timeVal === -1) {
      radiusScale.range([0, 12]); // smaller default
    } else {
      radiusScale.range([0, 18]); // bigger but still not huge
    }
    radiusScale.domain([0, maxTraffic]);

    circles = circles
      .data(stations, d => d.short_name)
      .join('circle')
      .attr('fill', 'steelblue')
      .attr('fill-opacity', 0.6)
      .attr('stroke', 'white')
      .attr('stroke-width', 1)
      // re‐set ratio for color
      .style('--departure-ratio', d => stationFlow(d.departures / d.totalTraffic))
      .each(function(d) {
        d3.select(this)
          .select('title')
          .text(`${d.totalTraffic} trips (Departures: ${d.departures}, Arrivals: ${d.arrivals})`);
      });

    updatePositions();
  }

  function onSliderInput() {
    const val = Number(timeSlider.value);
    selectedTime.textContent = formatTime(val);
    updateScatterPlot(val);
  }

  timeSlider.addEventListener('input', onSliderInput);
  onSliderInput();
});
