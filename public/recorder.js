// public/recorder.js
(function() {
  "use strict";

  // Read the domain key from the script tag's data attribute.
  const DOMAIN_TOKEN = document.currentScript.getAttribute("data-domain-key");
  if (!DOMAIN_TOKEN) {
    console.error("Recorder: No domain key provided. Please include data-domain-key attribute.");
    return;
  }

  // Utility: dynamically load external scripts.
  function loadScript(src) {
    return new Promise(function(resolve, reject) {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = function(err) {
        console.error("Failed to load script:", src, err);
        reject(err);
      };
      document.head.appendChild(script);
    });
  }

  // First, fetch the backend configuration (to know if console recording is enabled).
  fetch("/config")
    .then(function(res) { return res.json(); })
    .then(function(config) {
      // Build an array of required libraries.
      const libs = [
        "https://unpkg.com/rrweb@latest/dist/rrweb.min.js",
        "https://unpkg.com/rrdom@latest/dist/rrdom.umd.min.js",
        "https://unpkg.com/rrvideo@latest/dist/rrvideo.umd.min.js",
        "https://unpkg.com/@rrweb/rrweb-plugin-sequential-id-record@latest/dist/index.umd.min.js"
      ];
      // Optionally add the console record plugin if enabled.
      if (config.enableConsolePlugin) {
        libs.push("https://unpkg.com/@rrweb/rrweb-plugin-console-record@latest/dist/index.umd.min.js");
      }
      return Promise.all(libs.map(loadScript)).then(function() { return config; });
    })
    .then(function(config) {
      // Prepare plugins.
      var plugins = [];
      if (window.rrwebPluginSequentialIdRecord) {
        plugins.push(window.rrwebPluginSequentialIdRecord);
      }
      var videoPlugin = (window.rrvideo && typeof rrvideo.plugin === "function") ? rrvideo.plugin() : null;
      if (videoPlugin) {
        plugins.push(videoPlugin);
      }
      if (config.enableConsolePlugin && window.rrwebPluginConsoleRecord) {
        plugins.push(window.rrwebPluginConsoleRecord);
      }

      // Use localStorage to persist a session ID across pages.
      var SESSION_ID_KEY = "rrweb_session_id";
      var EVENTS_KEY = "rrweb_events";
      var sessionId = localStorage.getItem(SESSION_ID_KEY) ||
        "sess_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
      localStorage.setItem(SESSION_ID_KEY, sessionId);

      // Retrieve any previously stored events.
      var events = [];
      try {
        var stored = localStorage.getItem(EVENTS_KEY);
        if (stored) {
          events = JSON.parse(stored);
          if (!Array.isArray(events)) { events = []; }
        }
      } catch (err) {
        console.error("Recorder: Error parsing stored rrweb events:", err);
        events = [];
      }

      // Save events to localStorage.
      function saveEvents() {
        try {
          localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
        } catch (err) {
          console.error("Recorder: Error saving events:", err);
        }
      }
      function debounce(func, delay) {
        var timeout;
        return function() {
          clearTimeout(timeout);
          timeout = setTimeout(func, delay);
        };
      }
      var saveEventsDebounced = debounce(saveEvents, 500);

      // Start recording using rrweb with the prepared plugins.
      try {
        rrweb.record({
          emit: function(event) {
            events.push(event);
            saveEventsDebounced();
          },
          plugins: plugins
        });
      } catch (err) {
        console.error("Recorder: Error starting rrweb recording:", err);
      }

      // Function to send events to the backend.
      function sendEvents() {
        if (events.length === 0) return;
        var payload = {
          sessionId: sessionId,
          events: events,
          pageUrl: window.location.href,
          host: window.location.host,
          timestamp: Date.now(),
          domainToken: DOMAIN_TOKEN
        };
        var url = "https://yourserver.com/upload-session"; // Update with your backend endpoint.
        var payloadStr = JSON.stringify(payload);
        var sent = false;
        try {
          if (navigator.sendBeacon) {
            var blob = new Blob([payloadStr], { type: "application/json" });
            sent = navigator.sendBeacon(url, blob);
          }
        } catch (err) {
          console.error("Recorder: Error using sendBeacon:", err);
        }
        if (!sent) {
          fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payloadStr,
            credentials: "include"
          }).catch(function(err) {
            console.error("Recorder: Failed to send events via fetch:", err);
          });
        }
        events = [];
        saveEvents();
      }

      // Periodically send events and send on page unload.
      setInterval(sendEvents, 60000);
      window.addEventListener("beforeunload", sendEvents);
    })
    .catch(function(err) {
      console.error("Recorder: Error loading configuration or libraries:", err);
    });
})();
