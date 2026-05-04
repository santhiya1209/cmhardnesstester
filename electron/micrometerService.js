const { SerialPort } = require('serialport');
const {
  BINARY_FRAME_LENGTH,
  bufferToHex,
  formatDisplayValue,
  parseBinaryMicrometerFrame,
  validateBinaryMicrometerFrame,
} = require('./micrometerDecoder');

const DEFAULT_PORT = 'COM3';
const BAUD_RATES = [2300, 2400, 4800, 9600];
const DATA_BITS = 8;
const PARITY = 'none';
const STOP_BITS = 1;
const MAX_BUFFER_BYTES = 4096;
const MAX_ASCII_BUFFER_BYTES = 1024;
const NO_VALID_FRAME_TIMEOUT_MS = 5000;
const PULSE_GRACE_MS = 300;
const PULSE_PERIOD_MS = 350;
const PULSE_WIDTH_MS = 80;
const STABLE_SAMPLE_COUNT = 2;
const PULSE_MODES = ['alternate-high', 'rts-high', 'dtr-high', 'rts-low', 'dtr-low', 'none'];
const ASCII_LINE_TERMINATORS = new Set([0x08, 0x0a, 0x0c, 0x0d]);

function buildScanCandidates(portName) {
  const candidates = [];

  for (const baudRate of BAUD_RATES) {
    for (const pulseMode of PULSE_MODES) {
      candidates.push({
        path: portName,
        baudRate,
        dataBits: DATA_BITS,
        parity: PARITY,
        stopBits: STOP_BITS,
        pulseMode,
      });
    }
  }

  return candidates;
}

function describeConfig(config) {
  return `${config.path} ${config.baudRate}/${config.dataBits}/${config.parity}/${config.stopBits} pulse=${config.pulseMode}`;
}

function pulseModeDescription(mode) {
  switch (mode) {
    case 'alternate-high':
      return 'alternate DTR/RTS drop with both lines normally high';
    case 'rts-high':
      return 'RTS low->high pulse with DTR held high';
    case 'dtr-high':
      return 'DTR low->high pulse with RTS held high';
    case 'rts-low':
      return 'RTS high->low pulse with DTR held low';
    case 'dtr-low':
      return 'DTR high->low pulse with RTS held low';
    case 'none':
      return 'listen without request pulse';
    default:
      return mode;
  }
}

function byteToSearchChar(value) {
  if (ASCII_LINE_TERMINATORS.has(value)) {
    return '\n';
  }
  if (value === 0x09) {
    return ' ';
  }
  return value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : ' ';
}

function hasBinaryNoise(buffer) {
  for (const value of buffer.values()) {
    if (value === 0x09 || ASCII_LINE_TERMINATORS.has(value)) {
      continue;
    }
    if (value < 0x20 || value > 0x7e) {
      return true;
    }
  }
  return false;
}

function findAsciiReading(buffer) {
  const text = Array.from(buffer.values()).map(byteToSearchChar).join('');
  const match = /[+-]?\d+(?:[.,]\d+)?(?=[ \t]*(?:mm|MM)?[ \t]*\n)/.exec(text);

  if (!match || match.index === undefined) {
    return null;
  }

  const ascii = match[0].replace(',', '.');
  const value = Number(ascii);
  if (!Number.isFinite(value)) {
    return null;
  }

  const startIndex = match.index;
  let endIndex = startIndex + match[0].length;
  while (endIndex < text.length && (text[endIndex] === ' ' || text[endIndex] === '\t')) {
    endIndex += 1;
  }
  if (text.slice(endIndex, endIndex + 2).toLowerCase() === 'mm') {
    endIndex += 2;
  }

  return {
    ascii,
    value,
    rawFrame: Buffer.from(buffer.subarray(startIndex, endIndex)),
    endIndex,
  };
}

function trimAsciiBuffer(buffer, endIndex) {
  let nextIndex = endIndex;
  while (
    nextIndex < buffer.length &&
    (buffer[nextIndex] === 0x20 || buffer[nextIndex] === 0x09 || ASCII_LINE_TERMINATORS.has(buffer[nextIndex]))
  ) {
    nextIndex += 1;
  }
  return Buffer.from(buffer.subarray(nextIndex));
}

class MicrometerService {
  constructor() {
    this.webContents = null;
    this.port = null;
    this.portOpen = false;
    this.closingPort = false;
    this.rxBuffer = Buffer.alloc(0);
    this.asciiBuffer = Buffer.alloc(0);
    this.scanCandidates = [];
    this.scanCandidateIndex = 0;
    this.currentOpenConfig = null;
    this.lockedBaudRate = null;
    this.noValidFrameTimer = null;
    this.pulseStartTimer = null;
    this.requestPulseTimer = null;
    this.pulseLineFlip = false;
    this.totalBytesReceived = 0;
    this.lastCandidateValue = null;
    this.stableCount = 0;
    this.latestReading = null;
    this.lastInvalidFrameHex = '';

    this.state = {
      connected: false,
      portName: null,
      status: 'waiting',
      value: null,
      displayValue: 'Waiting for data...',
      unit: 'mm',
      raw: null,
      rawAscii: null,
      rawHex: '',
      lastError: null,
      updatedAt: null,
      timestamp: null,
      lockedBaudRate: null,
    };
  }

  attach(webContents) {
    this.webContents = webContents;
    const onGone = () => {
      this.webContents = null;
    };
    webContents.on('render-process-gone', onGone);
    webContents.on('destroyed', onGone);
  }

  detach(webContents) {
    if (this.webContents === webContents) {
      this.webContents = null;
    }
  }

  getState() {
    return { ...this.state };
  }

  getLatestReading() {
    return this.latestReading ? { ...this.latestReading } : null;
  }

  async open(portName = DEFAULT_PORT) {
    const normalizedPort = typeof portName === 'string' && portName.trim() ? portName.trim() : DEFAULT_PORT;

    if (this.portOpen) {
      console.log(
        '[micrometer] open requested while already open',
        this.currentOpenConfig ? describeConfig(this.currentOpenConfig) : this.state.portName
      );
      return { ok: true, alreadyOpen: true, state: this.getState() };
    }

    this.scanCandidates = buildScanCandidates(normalizedPort);
    this.scanCandidateIndex = 0;
    this.lockedBaudRate = null;
    this.latestReading = null;
    this._resetRollingState();

    const opened = await this._openCurrentCandidate();
    return opened ? { ok: true, state: this.getState() } : { ok: false, error: 'OPEN_FAILED', state: this.getState() };
  }

  async close() {
    this.scanCandidates = [];
    this.scanCandidateIndex = 0;
    this.lockedBaudRate = null;
    this.latestReading = null;
    this._closeSerialPort(false);
    this._setState({
      connected: false,
      portName: this.state.portName,
      value: null,
      displayValue: 'Waiting for data...',
      raw: null,
      rawAscii: null,
      rawHex: '',
      lastError: null,
      lockedBaudRate: null,
    });
    return { ok: true };
  }

  async shutdown() {
    try {
      await this.close();
    } catch {
      // Ignore shutdown cleanup failures.
    }
  }

  _emit() {
    const wc = this.webContents;
    if (!wc || wc.isDestroyed()) {
      return;
    }

    try {
      wc.send('micrometer:state', this.getState());
    } catch (err) {
      console.warn('[micrometer] IPC state send failed:', err && err.message ? err.message : err);
    }
  }

  _setState(patch, emit = true) {
    const timestamp = typeof patch.timestamp === 'number' ? patch.timestamp : Date.now();
    const merged = {
      ...this.state,
      ...patch,
      timestamp,
      updatedAt: new Date(timestamp).toISOString(),
      unit: 'mm',
    };

    if (!merged.connected) {
      merged.status = 'invalid';
      merged.displayValue = 'Waiting for data...';
    } else if (merged.value !== null && Number.isFinite(merged.value)) {
      merged.status = 'valid';
      merged.displayValue = formatDisplayValue(merged.value);
    } else {
      merged.status = 'waiting';
      merged.displayValue = 'Waiting for data...';
    }

    this.state = merged;

    if (emit) {
      this._emit();
    }
  }

  _resetRollingState() {
    this.rxBuffer = Buffer.alloc(0);
    this.asciiBuffer = Buffer.alloc(0);
    this.lastCandidateValue = null;
    this.stableCount = 0;
    this.lastInvalidFrameHex = '';
    this.totalBytesReceived = 0;
  }

  async _openCurrentCandidate() {
    const config = this.scanCandidates[this.scanCandidateIndex];
    if (!config) {
      this._setState({
        connected: false,
        lastError: 'No micrometer scan candidates available',
      });
      return false;
    }

    this._closeSerialPort(false);
    this._resetRollingState();
    this.currentOpenConfig = config;

    console.log(
      '[micrometer] trying candidate',
      `${this.scanCandidateIndex + 1}/${this.scanCandidates.length}`,
      describeConfig(config)
    );
    console.log('[micrometer] serial open config', {
      path: config.path,
      baudRate: config.baudRate,
      dataBits: config.dataBits,
      parity: config.parity,
      stopBits: config.stopBits,
      pulseMode: config.pulseMode,
    });

    let nextPort;
    try {
      nextPort = new SerialPort({
        path: config.path,
        baudRate: config.baudRate,
        dataBits: config.dataBits,
        parity: config.parity,
        stopBits: config.stopBits,
        autoOpen: false,
      });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      console.warn('[micrometer] serial create failed:', message);
      return this._tryNextCandidate(message);
    }

    this.port = nextPort;
    this._bindPortEvents(nextPort, config);

    try {
      await new Promise((resolve, reject) => {
        nextPort.open((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      console.warn('[micrometer] serial open failed:', message);
      this.port = null;
      this.currentOpenConfig = null;
      return this._tryNextCandidate(message);
    }

    this.portOpen = true;
    console.log('[micrometer] serial port opened', describeConfig(config));

    this._primeControlLines(config.pulseMode);
    this._scheduleRequestPulse(config.pulseMode);
    this._scheduleNoValidFrameTimeout();
    this._setState({
      connected: true,
      portName: config.path,
      value: null,
      displayValue: 'Waiting for data...',
      raw: null,
      rawAscii: null,
      rawHex: '',
      lastError: null,
      lockedBaudRate: null,
    });

    return true;
  }

  _bindPortEvents(port, config) {
    port.on('data', (chunk) => this._onRawData(chunk));

    port.on('error', (error) => {
      const message = error && error.message ? error.message : String(error);
      console.warn('[micrometer] serial error:', message);
      if (!this.lockedBaudRate) {
        this._tryNextCandidate(message);
        return;
      }
      this._closeSerialPort(false);
      this._setState({
        connected: false,
        value: null,
        raw: null,
        rawAscii: null,
        rawHex: '',
        lastError: message,
      });
    });

    port.on('close', () => {
      console.log('[micrometer] serial port closed', describeConfig(config));
      if (this.closingPort) {
        return;
      }
      this.portOpen = false;
      if (!this.lockedBaudRate) {
        this._tryNextCandidate('Port closed before a valid frame was received');
        return;
      }
      this._setState({
        connected: false,
        value: null,
        raw: null,
        rawAscii: null,
        rawHex: '',
        lastError: 'Micrometer port closed',
      });
    });
  }

  _primeControlLines(mode) {
    if (mode === 'none') {
      return;
    }

    const initialState =
      mode === 'rts-low' || mode === 'dtr-low'
        ? { dtr: false, rts: false }
        : { dtr: true, rts: true };

    this._setControlLines(initialState, 'initial DTR/RTS');
  }

  _scheduleRequestPulse(mode) {
    this._stopRequestPulse();

    if (mode === 'none') {
      console.log(`[micrometer] ${pulseModeDescription(mode)}`);
      return;
    }

    this.pulseStartTimer = setTimeout(() => {
      this.pulseStartTimer = null;
      if (!this.portOpen || !this.port || !this.port.isOpen) {
        return;
      }

      console.log(`[micrometer] starting REQUEST pulse mode: ${pulseModeDescription(mode)}`);
      this.requestPulseTimer = setInterval(() => {
        if (!this.portOpen || !this.port || !this.port.isOpen) {
          return;
        }

        const { firstState, secondState, label } = this._pulseStates(mode);
        this._setControlLines(firstState, label);
        setTimeout(() => {
          if (!this.portOpen || !this.port || !this.port.isOpen) {
            return;
          }
          this._setControlLines(secondState, `${label} restore`);
        }, PULSE_WIDTH_MS);
      }, PULSE_PERIOD_MS);
    }, PULSE_GRACE_MS);
  }

  _pulseStates(mode) {
    switch (mode) {
      case 'alternate-high': {
        const useDtr = this.pulseLineFlip;
        this.pulseLineFlip = !this.pulseLineFlip;
        return {
          firstState: useDtr ? { dtr: false, rts: true } : { dtr: true, rts: false },
          secondState: { dtr: true, rts: true },
          label: useDtr ? 'DTR' : 'RTS',
        };
      }
      case 'rts-high':
        return { firstState: { dtr: true, rts: false }, secondState: { dtr: true, rts: true }, label: 'RTS' };
      case 'dtr-high':
        return { firstState: { dtr: false, rts: true }, secondState: { dtr: true, rts: true }, label: 'DTR' };
      case 'rts-low':
        return { firstState: { dtr: false, rts: true }, secondState: { dtr: false, rts: false }, label: 'RTS' };
      case 'dtr-low':
        return { firstState: { dtr: true, rts: false }, secondState: { dtr: false, rts: false }, label: 'DTR' };
      default:
        return { firstState: { dtr: true, rts: true }, secondState: { dtr: true, rts: true }, label: 'DTR/RTS' };
    }
  }

  _setControlLines(state, label) {
    if (!this.port || !this.port.isOpen) {
      return;
    }

    this.port.set(state, (err) => {
      if (err) {
        console.warn(`[micrometer] ${label} control-line failed:`, err.message);
      }
    });
  }

  _stopRequestPulse() {
    if (this.pulseStartTimer) {
      clearTimeout(this.pulseStartTimer);
      this.pulseStartTimer = null;
    }

    if (this.requestPulseTimer) {
      clearInterval(this.requestPulseTimer);
      this.requestPulseTimer = null;
    }
  }

  _scheduleNoValidFrameTimeout() {
    this._clearNoValidFrameTimeout();
    this.noValidFrameTimer = setTimeout(() => {
      this.noValidFrameTimer = null;
      if (this.lockedBaudRate) {
        return;
      }
      this._tryNextCandidate('No valid binary micrometer frame within timeout');
    }, NO_VALID_FRAME_TIMEOUT_MS);
  }

  _clearNoValidFrameTimeout() {
    if (this.noValidFrameTimer) {
      clearTimeout(this.noValidFrameTimer);
      this.noValidFrameTimer = null;
    }
  }

  _closeSerialPort(emitDisconnected = true) {
    this._clearNoValidFrameTimeout();
    this._stopRequestPulse();

    if (this.port) {
      const portToClose = this.port;
      this.closingPort = true;
      try {
        portToClose.removeAllListeners('data');
        portToClose.removeAllListeners('error');
        portToClose.removeAllListeners('close');
        if (portToClose.isOpen) {
          portToClose.close(() => {
            this.closingPort = false;
          });
        } else {
          this.closingPort = false;
        }
      } catch (err) {
        this.closingPort = false;
        console.warn('[micrometer] serial close warning:', err && err.message ? err.message : err);
      }
    }

    this.port = null;
    this.portOpen = false;
    this.currentOpenConfig = null;
    this._resetRollingState();

    if (emitDisconnected) {
      this._setState({
        connected: false,
        value: null,
        raw: null,
        rawAscii: null,
        rawHex: '',
      });
    }
  }

  _tryNextCandidate(reason) {
    this._closeSerialPort(false);

    if (this.lockedBaudRate) {
      return true;
    }

    if (this.scanCandidateIndex + 1 >= this.scanCandidates.length) {
      console.warn('[micrometer] scan exhausted:', reason);
      this._setState({
        connected: false,
        value: null,
        raw: null,
        rawAscii: null,
        rawHex: '',
        lastError: reason || 'No valid binary micrometer frame found',
      });
      return false;
    }

    const previous = this.scanCandidates[this.scanCandidateIndex];
    this.scanCandidateIndex += 1;
    const next = this.scanCandidates[this.scanCandidateIndex];
    console.warn(
      `[micrometer] invalid/no frame on ${describeConfig(previous)}; ` +
        `discarding rolling buffer and trying ${describeConfig(next)}. reason=${reason || 'unknown'}`
    );

    setTimeout(() => {
      if (this.lockedBaudRate) {
        return;
      }
      void this._openCurrentCandidate();
    }, 400);

    return true;
  }

  _onRawData(chunk) {
    if (!Buffer.isBuffer(chunk) || chunk.length === 0) {
      return;
    }

    console.log(`[micrometer] raw chunk HEX ${bufferToHex(chunk)}`);
    this.totalBytesReceived += chunk.length;
    this.rxBuffer = Buffer.from(Buffer.concat([this.rxBuffer, chunk]).subarray(-MAX_BUFFER_BYTES));
    this.asciiBuffer = Buffer.from(
      Buffer.concat([this.asciiBuffer, chunk]).subarray(-MAX_ASCII_BUFFER_BYTES)
    );

    const acceptedAscii = this._consumeAsciiBuffer();
    if (!acceptedAscii && hasBinaryNoise(chunk)) {
      this._consumeRollingBuffer();
    }
  }

  _consumeAsciiBuffer() {
    if (this.asciiBuffer.length === 0) {
      return false;
    }

    let accepted = false;

    while (this.asciiBuffer.length > 0) {
      const reading = findAsciiReading(this.asciiBuffer);

      if (!reading) {
        const terminatorIndexes = Array.from(ASCII_LINE_TERMINATORS)
          .map((terminator) => this.asciiBuffer.indexOf(terminator))
          .filter((index) => index >= 0);
        const terminatorIndex = terminatorIndexes.length > 0 ? Math.min(...terminatorIndexes) : -1;

        if (terminatorIndex >= 0) {
          const discarded = this.asciiBuffer.subarray(0, terminatorIndex);
          if (discarded.length > 0) {
            console.log(`[micrometer] ASCII candidate discarded reason=no-number hex=${bufferToHex(discarded)}`);
          }
          this.asciiBuffer = trimAsciiBuffer(this.asciiBuffer, terminatorIndex + 1);
          continue;
        }

        break;
      }

      this.asciiBuffer = trimAsciiBuffer(this.asciiBuffer, reading.endIndex);
      this._handleAsciiReading(reading.rawFrame, reading);
      accepted = true;
      this.rxBuffer = Buffer.alloc(0);
    }

    return accepted;
  }

  _handleAsciiReading(frame, parsed) {
    const rawHex = bufferToHex(frame);

    if (!this.lockedBaudRate && this.currentOpenConfig) {
      this.lockedBaudRate = this.currentOpenConfig.baudRate;
      this._clearNoValidFrameTimeout();
      console.log(`[micrometer] baud locked ${this.lockedBaudRate} using ASCII DATA line`);
      this._setState({ lockedBaudRate: this.lockedBaudRate }, false);
    }

    const decoded = {
      rawHex,
      value: parsed.value,
      displayValue: formatDisplayValue(parsed.value),
      decimalPlaces: 3,
      unit: 'mm',
      source: 'ascii',
    };

    console.log(`[micrometer] decoded ASCII value ${decoded.displayValue} raw="${parsed.ascii}" hex=${rawHex}`);
    this._publishReading(decoded);
  }

  _consumeRollingBuffer() {
    while (this.rxBuffer.length >= BINARY_FRAME_LENGTH) {
      const syncOffset = this.rxBuffer.indexOf(Buffer.from([0x00, 0x00, 0x20]));

      if (syncOffset < 0) {
        const discarded = this.rxBuffer.subarray(0, this.rxBuffer.length - 2);
        if (discarded.length > 0) {
          console.log(`[micrometer] invalid frame discarded reason=no-sync hex=${bufferToHex(discarded)}`);
        }
        this.rxBuffer = Buffer.from(this.rxBuffer.subarray(Math.max(0, this.rxBuffer.length - 2)));
        return;
      }

      if (syncOffset > 0) {
        const discarded = this.rxBuffer.subarray(0, syncOffset);
        console.log(`[micrometer] invalid frame discarded reason=leading-noise hex=${bufferToHex(discarded)}`);
        this.rxBuffer = Buffer.from(this.rxBuffer.subarray(syncOffset));
      }

      if (this.rxBuffer.length < BINARY_FRAME_LENGTH) {
        return;
      }

      const frame = Buffer.from(this.rxBuffer.subarray(0, BINARY_FRAME_LENGTH));
      const validation = validateBinaryMicrometerFrame(frame);

      if (!validation.ok) {
        if (validation.rawHex !== this.lastInvalidFrameHex) {
          this.lastInvalidFrameHex = validation.rawHex;
          console.log(
            `[micrometer] invalid frame discarded reason=${validation.reason} hex=${validation.rawHex}`
          );
        }
        this.rxBuffer = Buffer.from(this.rxBuffer.subarray(1));
        continue;
      }

      this.rxBuffer = Buffer.from(this.rxBuffer.subarray(BINARY_FRAME_LENGTH));
      this._handleValidFrame(frame);
    }
  }

  _handleValidFrame(frame) {
    const rawHex = bufferToHex(frame);
    console.log(`[micrometer] valid frame HEX ${rawHex}`);

    const decoded = parseBinaryMicrometerFrame(frame);
    if (!decoded) {
      console.log(`[micrometer] invalid frame discarded reason=decoder-null hex=${rawHex}`);
      return;
    }

    if (!this.lockedBaudRate && this.currentOpenConfig) {
      this.lockedBaudRate = this.currentOpenConfig.baudRate;
      this._clearNoValidFrameTimeout();
      console.log(`[micrometer] baud locked ${this.lockedBaudRate}`);
      this._setState({ lockedBaudRate: this.lockedBaudRate }, false);
    }

    console.log(`[micrometer] decoded value ${decoded.displayValue} raw=${rawHex}`);
    this._acceptStableValue(decoded);
  }

  _acceptStableValue(decoded) {
    const valueKey = decoded.value.toFixed(3);

    if (!this.latestReading && this.lastCandidateValue === null) {
      console.log('[micrometer] first strict DATA frame accepted');
      this.lastCandidateValue = valueKey;
      this.stableCount = 1;
      this._publishReading(decoded);
      return;
    }

    if (this.lastCandidateValue === valueKey) {
      this.stableCount += 1;
    } else {
      this.lastCandidateValue = valueKey;
      this.stableCount = 1;
    }

    if (this.stableCount < STABLE_SAMPLE_COUNT) {
      console.log(
        `[micrometer] stable filter waiting value=${valueKey} count=${this.stableCount}/${STABLE_SAMPLE_COUNT}`
      );
      return;
    }

    this._publishReading(decoded);
  }

  _publishReading(decoded) {
    const timestamp = Date.now();
    this.latestReading = {
      raw: decoded.rawHex,
      value: decoded.value,
      unit: 'mm',
      timestamp,
    };

    console.log(`[micrometer] publish UI value ${decoded.displayValue}`);
    this._setState({
      connected: true,
      portName: this.currentOpenConfig ? this.currentOpenConfig.path : this.state.portName,
      value: decoded.value,
      raw: decoded.rawHex,
      rawAscii: null,
      rawHex: decoded.rawHex,
      lastError: null,
      timestamp,
      lockedBaudRate: this.lockedBaudRate,
    });
  }
}

const micrometerService = new MicrometerService();

module.exports = {
  buildScanCandidates,
  findAsciiReading,
  micrometerService,
};
