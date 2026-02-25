import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "attendance_admin_logged_in";
const RESCAN_LOCK_MS = 2500;
const POPUP_TIMEOUT_MS = 2200;

function normalizeQrKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function extractRegNumberFromObject(data) {
  if (!data || typeof data !== "object") {
    return "";
  }

  const normalizedEntries = Object.entries(data).map(([key, value]) => [
    normalizeQrKey(key),
    value,
  ]);

  const keyPriority = [
    "registrationnumber",
    "regnumber",
    "registrationno",
    "regno",
  ];

  for (const expectedKey of keyPriority) {
    const entry = normalizedEntries.find(([key]) => key === expectedKey);
    if (!entry) {
      continue;
    }

    const value = String(entry[1] || "").trim();
    if (value) {
      return value;
    }
  }

  return "";
}

function extractRegNumberFromText(text) {
  const labeledMatch = text.match(
    /registration\s*(?:number|no\.?)\s*[:#-]?\s*([A-Za-z0-9-]+)/i
  );
  if (labeledMatch && labeledMatch[1]) {
    return labeledMatch[1].trim();
  }

  const tokens = text.match(/[A-Za-z0-9-]{5,}/g) || [];
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (/[A-Za-z]/.test(token) && /\d/.test(token)) {
      return token;
    }
  }

  return text;
}

export default function Home() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [loadingScanner, setLoadingScanner] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginForm, setLoginForm] = useState({
    username: "",
    password: "",
  });
  const [manualReg, setManualReg] = useState("");
  const [message, setMessage] = useState(null);
  const [popup, setPopup] = useState(null);
  const [lastScanned, setLastScanned] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const scannerRef = useRef(null);
  const ignoreUntilRef = useRef(0);
  const popupTimerRef = useRef(null);
  const audioContextRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "true") {
      setLoggedIn(true);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (popupTimerRef.current) {
        clearTimeout(popupTimerRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, []);

  const statusClass = useMemo(() => {
    if (!message) return "";
    if (message.type === "success") return "status status-success";
    if (message.type === "warn") return "status status-warn";
    return "status status-error";
  }, [message]);

  const setStatus = useCallback((next) => {
    setMessage(next);
  }, []);

  const showPopup = useCallback((type, text) => {
    setPopup({ type, text });

    if (popupTimerRef.current) {
      clearTimeout(popupTimerRef.current);
    }

    popupTimerRef.current = setTimeout(() => {
      setPopup(null);
    }, POPUP_TIMEOUT_MS);
  }, []);

  const ensureAudioContext = useCallback(() => {
    if (typeof window === "undefined") return null;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioCtx();
    }

    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume().catch(() => {});
    }

    return audioContextRef.current;
  }, []);

  const playFeedbackTone = useCallback(
    (type) => {
      const context = ensureAudioContext();
      if (!context) return;

      const patterns = {
        success: {
          gap: 0.04,
          tones: [
            {
              frequency: 659.25,
              duration: 0.1,
              volume: 0.08,
              waveform: "triangle",
            },
            {
              frequency: 987.77,
              duration: 0.12,
              volume: 0.09,
              waveform: "triangle",
            },
            {
              frequency: 1318.51,
              duration: 0.15,
              volume: 0.075,
              waveform: "sine",
            },
          ],
        },
        warn: {
          gap: 0.08,
          tones: [
            {
              frequency: 560,
              duration: 0.11,
              volume: 0.07,
              waveform: "triangle",
            },
            {
              frequency: 640,
              duration: 0.11,
              volume: 0.06,
              waveform: "triangle",
            },
          ],
        },
        error: {
          gap: 0.05,
          tones: [
            {
              frequency: 392,
              duration: 0.16,
              volume: 0.11,
              waveform: "sawtooth",
              bendTo: 330,
            },
            {
              frequency: 329.63,
              duration: 0.22,
              volume: 0.12,
              waveform: "sawtooth",
              bendTo: 246.94,
            },
          ],
        },
      };

      const selectedPattern = patterns[type] || patterns.error;
      const masterGain = context.createGain();
      const compressor = context.createDynamicsCompressor();

      masterGain.gain.value = 0.9;
      compressor.threshold.value = -28;
      compressor.knee.value = 18;
      compressor.ratio.value = 10;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.12;

      masterGain.connect(compressor);
      compressor.connect(context.destination);

      let start = context.currentTime + 0.005;

      selectedPattern.tones.forEach((tone, index) => {
        const oscillator = context.createOscillator();
        const gainNode = context.createGain();

        oscillator.type = tone.waveform || "sine";
        oscillator.frequency.setValueAtTime(tone.frequency, start);
        if (tone.bendTo) {
          oscillator.frequency.exponentialRampToValueAtTime(
            tone.bendTo,
            start + tone.duration
          );
        }

        gainNode.gain.setValueAtTime(0.0001, start);
        gainNode.gain.exponentialRampToValueAtTime(tone.volume, start + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(
          Math.max(tone.volume * 0.55, 0.0002),
          start + tone.duration * 0.65
        );
        gainNode.gain.exponentialRampToValueAtTime(
          0.0001,
          start + tone.duration + 0.06
        );

        oscillator.connect(gainNode);
        gainNode.connect(masterGain);

        oscillator.start(start);
        oscillator.stop(start + tone.duration + 0.08);

        if (index < selectedPattern.tones.length - 1) {
          start += tone.duration + selectedPattern.gap;
        }
      });
    },
    [ensureAudioContext]
  );

  const pushFeedback = useCallback(
    (type, text) => {
      setStatus({ type, text });
      showPopup(type, text);
      playFeedbackTone(type);

      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        if (type === "success") {
          navigator.vibrate(55);
        } else if (type === "warn") {
          navigator.vibrate([35, 50, 35]);
        } else {
          navigator.vibrate([110, 70, 110]);
        }
      }
    },
    [playFeedbackTone, setStatus, showPopup]
  );

  const extractRegNumber = useCallback((rawQrValue) => {
    const text = String(rawQrValue || "").trim();
    if (!text) return "";

    try {
      const parsed = JSON.parse(text);
      const fromJson = extractRegNumberFromObject(parsed);
      if (fromJson) {
        return fromJson;
      }
    } catch {
      // Not JSON; continue as plain text.
    }

    return extractRegNumberFromText(text).trim();
  }, []);

  const markAttendance = useCallback(
    async (rawQrValue) => {
      const extractedRegNumber = extractRegNumber(rawQrValue);
      if (!extractedRegNumber) {
        pushFeedback("error", "Invalid QR data. Missing registration number.");
        return;
      }

      if (isProcessing) {
        return;
      }

      const normalizedRegNumber = extractedRegNumber.toUpperCase();
      const now = Date.now();
      if (
        normalizedRegNumber === lastScanned &&
        now < ignoreUntilRef.current
      ) {
        return;
      }

      setIsProcessing(true);
      ignoreUntilRef.current = now + RESCAN_LOCK_MS;
      setLastScanned(normalizedRegNumber);

      try {
        const res = await fetch("/api/mark-attendance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reg_number: normalizedRegNumber,
            registration_number: normalizedRegNumber,
          }),
        });

        let data = {};
        try {
          data = await res.json();
        } catch {
          data = {};
        }

        if (!res.ok) {
          pushFeedback("error", data.error || "Scan failed");
          return;
        }

        if (data.status === "already") {
          pushFeedback("warn", data.message || "Already marked");
          return;
        }

        pushFeedback("success", data.message || "Attendance marked");
      } catch (error) {
        pushFeedback("error", error.message || "Network error");
      } finally {
        setIsProcessing(false);
      }
    },
    [extractRegNumber, isProcessing, lastScanned, pushFeedback]
  );

  useEffect(() => {
    if (!loggedIn) return;
    if (typeof window === "undefined") return;
    if (scannerRef.current) return;

    let cancelled = false;
    let scanner = null;

    const startScanner = async () => {
      setLoadingScanner(true);

      try {
        const { Html5QrcodeScanner } = await import("html5-qrcode");
        if (cancelled) return;

        scanner = new Html5QrcodeScanner(
          "qr-reader",
          { fps: 10, qrbox: { width: 260, height: 260 } },
          false
        );

        const onScanSuccess = (decodedText) => {
          markAttendance(decodedText);
        };

        scanner.render(onScanSuccess, () => {});
        scannerRef.current = scanner;
      } catch (error) {
        const text = error?.message
          ? `Scanner error: ${error.message}`
          : "Unable to start scanner";
        setStatus({ type: "error", text });
      } finally {
        if (!cancelled) {
          setLoadingScanner(false);
        }
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      const activeScanner = scannerRef.current || scanner;
      if (activeScanner) {
        activeScanner.clear().catch(() => {});
      }
      scannerRef.current = null;
    };
  }, [loggedIn, markAttendance, setStatus]);

  const handleLoginChange = (event) => {
    const { name, value } = event.target;
    setLoginForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    if (isLoggingIn) return;

    ensureAudioContext();
    setStatus(null);
    setIsLoggingIn(true);

    const payload = {
      username: String(loginForm.username || "").trim(),
      password: String(loginForm.password || ""),
    };

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let data = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }

      if (!res.ok) {
        setStatus({ type: "error", text: data.error || "Login failed" });
        return;
      }

      setLoggedIn(true);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, "true");
      }
      setStatus({ type: "success", text: "Access granted. Scanner ready." });
    } catch (error) {
      setStatus({ type: "error", text: error.message || "Network error" });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setLoggedIn(false);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    setStatus({ type: "warn", text: "Logged out." });
    setPopup(null);
  };

  const handleManualSubmit = (event) => {
    event.preventDefault();
    const trimmed = String(manualReg || "").trim();
    if (!trimmed) return;

    markAttendance(trimmed);
    setManualReg("");
  };

  const popupTitle = useMemo(() => {
    if (!popup) return "";
    if (popup.type === "success") return "Attendance Marked";
    if (popup.type === "warn") return "Already Marked";
    return "Scan Error";
  }, [popup]);

  return (
    <main className="page">
      <div className="glow" aria-hidden="true" />

      {popup && (
        <div className={`toast toast-${popup.type}`} role="alert" aria-live="assertive">
          <p className="toast-title">{popupTitle}</p>
          <p className="toast-text">{popup.text}</p>
        </div>
      )}

      <header className="hero">
        <p className="eyebrow">SwiftCheck FYI</p>
        <h1>QR Attendance System</h1>
        <p className="subhead">
          Fast, accurate check-ins powered by Google Sheets and a camera-ready
          scanner.
        </p>
      </header>

      <section className="grid">
        {!loggedIn ? (
          <div className="card">
            <h2>Admin Login</h2>
            <p className="muted">
              Use your Google Sheet admin credentials to unlock scanning.
            </p>
            <form onSubmit={handleLogin} className="form">
              <label>
                Username
                <input
                  name="username"
                  value={loginForm.username}
                  onChange={handleLoginChange}
                  placeholder="admin"
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  value={loginForm.password}
                  onChange={handleLoginChange}
                  type="password"
                  placeholder="****"
                  autoComplete="current-password"
                  required
                />
              </label>
              <button type="submit" className="primary" disabled={isLoggingIn}>
                {isLoggingIn ? "Signing in..." : "Unlock Scanner"}
              </button>
            </form>
          </div>
        ) : (
          <div className="card scan-card">
            <div className="card-top">
              <div>
                <h2>Scanner Live</h2>
                <p className="muted">
                  Supports plain reg number, JSON registration_number, or
                  labeled text payloads.
                </p>
              </div>
              <button type="button" className="ghost" onClick={handleLogout}>
                Log out
              </button>
            </div>

            <div className="scanner-shell">
              <div id="qr-reader" />
              {loadingScanner && (
                <div className="scanner-overlay">
                  <span>Starting camera...</span>
                </div>
              )}
            </div>

            <div className="manual">
              <p className="muted">Manual fallback</p>
              <form onSubmit={handleManualSubmit} className="manual-form">
                <input
                  value={manualReg}
                  onChange={(event) => setManualReg(event.target.value)}
                  placeholder="Enter reg number"
                  disabled={isProcessing}
                />
                <button type="submit" className="primary" disabled={isProcessing}>
                  Mark
                </button>
              </form>
            </div>
          </div>
        )}

        <div className="card info-card">
          <h2>Live Status</h2>
          <p className="muted">Every scan updates your Google Sheet in real time.</p>

          {message ? (
            <div className={statusClass}>
              <span>{message.text}</span>
            </div>
          ) : (
            <div className="status status-idle">
              <span>Ready for the next scan.</span>
            </div>
          )}

          <div className="stats">
            <div>
              <p className="label">Last Scan</p>
              <p className="value">{lastScanned || "-"}</p>
            </div>
            <div>
              <p className="label">Processing</p>
              <p className="value">{isProcessing ? "Yes" : "No"}</p>
            </div>
          </div>

        </div>
      </section>
    </main>
  );
}
