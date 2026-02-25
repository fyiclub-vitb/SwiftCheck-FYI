import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "attendance_admin_logged_in";
const RESCAN_LOCK_MS = 2500;
const POPUP_TIMEOUT_MS = 2200;

export default function Home() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [loadingScanner, setLoadingScanner] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginForm, setLoginForm] = useState({
    username: "",
    password: "",
    adminSecret: "",
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
        success: [
          { frequency: 880, duration: 0.11, volume: 0.09 },
          { frequency: 1174, duration: 0.11, volume: 0.09 },
        ],
        warn: [{ frequency: 520, duration: 0.2, volume: 0.08 }],
        error: [
          { frequency: 240, duration: 0.14, volume: 0.12 },
          { frequency: 180, duration: 0.2, volume: 0.12 },
        ],
      };

      const tones = patterns[type] || patterns.error;
      let start = context.currentTime;

      tones.forEach((tone, index) => {
        const oscillator = context.createOscillator();
        const gainNode = context.createGain();

        oscillator.type = "sine";
        oscillator.frequency.value = tone.frequency;

        gainNode.gain.setValueAtTime(0.0001, start);
        gainNode.gain.exponentialRampToValueAtTime(tone.volume, start + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(
          0.0001,
          start + tone.duration
        );

        oscillator.connect(gainNode);
        gainNode.connect(context.destination);

        oscillator.start(start);
        oscillator.stop(start + tone.duration + 0.02);

        if (index < tones.length - 1) {
          start += tone.duration + 0.04;
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
      if (parsed && typeof parsed === "object") {
        return String(
          parsed.registration_number ||
            parsed.reg_number ||
            parsed.registrationNumber ||
            ""
        ).trim();
      }
    } catch {
      return text;
    }

    return text;
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
      adminSecret: String(loginForm.adminSecret || "").trim(),
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
              <label>
                Admin Secret (optional)
                <input
                  name="adminSecret"
                  value={loginForm.adminSecret}
                  onChange={handleLoginChange}
                  placeholder="Only if enabled"
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
                  Supports plain reg number or JSON QR with
                  registration_number.
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

          <div className="tips">
            <p className="label">Checklist</p>
            <ul>
              <li>Sheet tabs named exactly: admins, users</li>
              <li>Service account has Editor access</li>
              <li>QR has reg number or registration_number in JSON</li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
