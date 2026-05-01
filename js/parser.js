/**
 * VCDS .txt log parser — v2
 * Full-scan export format (VCDS Windows software, English).
 *
 * Handles:
 *  - Classic KWP-1281 / KWP-2000 modules
 *  - CAN / UDS modules (7-digit VAG codes, UDS P-codes with status byte)
 *  - "Cannot be reached" AND "No Response" statuses
 *  - Fault frequency, priority, reset counter, fault status byte
 *  - Shop # (WSC) and VCID extraction
 *  - Mileage in "XXXXkm-XXXXmi" combined format
 *  - Data version header field
 */
function parseVCDS(rawText) {
  const result = {
    scanDate:     '',
    scanTimestamp: 0,
    vcdsVersion:  '',
    dataVersion:  '',
    vin:          '',
    mileage:      0,
    chassisType:  '',
    modules:      [],
    totalFaults:  0
  };

  const lines = rawText.split('\n');

  // ── Date — first line: Thursday,30,April,2026,19:23:25:00009
  const firstLine = (lines[0] || '').trim();
  const dateParts = firstLine.split(',');
  if (dateParts.length >= 5) {
    const monthMap = {
      January:0, February:1, March:2,  April:3,
      May:4,     June:5,     July:6,   August:7,
      September:8, October:9, November:10, December:11
    };
    const day   = parseInt(dateParts[1]);
    const month = monthMap[dateParts[2]] ?? 0;
    const year  = parseInt(dateParts[3]);
    const tp    = (dateParts[4] || '').split(':');
    result.scanTimestamp = new Date(
      year, month, day,
      parseInt(tp[0] || 0), parseInt(tp[1] || 0), parseInt(tp[2] || 0)
    ).getTime();
    result.scanDate = `${dateParts[1]} ${dateParts[2]} ${dateParts[3]}`;
  }

  // ── Header fields (scan through all lines)
  for (const raw of lines) {
    const line = raw.trim();

    if (line.startsWith('VCDS Version:'))
      result.vcdsVersion = line.replace('VCDS Version:', '').trim();

    if (line.startsWith('Data version:'))
      result.dataVersion = line.replace('Data version:', '').trim();

    if (line.startsWith('Chassis Type:'))
      result.chassisType = line.replace('Chassis Type:', '').trim();

    // VIN + Mileage on same line: "VIN: XXXXXXX  Mileage: 45000km-27961mi"
    if (line.startsWith('VIN:') && line.includes('Mileage:')) {
      const vm = line.match(/VIN:\s*(\S+)/);
      const mm = line.match(/Mileage:\s*(\d+)\s*km/i);   // capture km part only
      if (vm) result.vin     = vm[1];
      if (mm) result.mileage = parseInt(mm[1]);
    }

    // VIN alone (some versions split the line)
    if (line.startsWith('VIN:') && !line.includes('Mileage:') && !result.vin) {
      const vm = line.match(/VIN:\s*(\S+)/);
      if (vm && vm[1].length > 5) result.vin = vm[1];
    }

    // Mileage on its own line
    if (!result.mileage && /^Mileage:/i.test(line)) {
      const mm = line.match(/Mileage:\s*(\d+)\s*km/i);
      if (mm) result.mileage = parseInt(mm[1]);
    }
  }

  // ── Module summary table
  // Pattern: "01-Engine -- Status: OK 0000"
  //          "02-Auto Trans -- Status: Malfunction 0010"
  //          "03-ABS Brakes -- Status: Cannot be reached 0000"
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(/^([0-9A-Fa-f]{2})-(.+?)\s*--\s*Status:\s*([\w\s]+?)\s+(\d{4})$/);
    if (m) {
      const addr = m[1].toUpperCase();
      if (!result.modules.find(x => x.address === addr)) {
        result.modules.push({
          address:    addr,
          name:       m[2].trim(),
          status:     m[3].trim(),
          statusCode: m[4],
          component:  '',
          partNoSW:   '',
          partNoHW:   '',
          coding:     '',
          shopNo:     '',
          vcid:       '',
          faults:     []
        });
      }
    }
  }

  // ── Split into address blocks (separated by 30+ dashes)
  const sepRx   = /^-{30,}$/;
  const blocks  = [];
  let   current = [];
  for (const raw of lines) {
    if (sepRx.test(raw.trim())) {
      if (current.length > 0) { blocks.push(current.join('\n')); current = []; }
    } else {
      current.push(raw);
    }
  }
  if (current.length > 0) blocks.push(current.join('\n'));

  // ── Parse each address block
  for (const block of blocks) {
    const addrMatch = block.match(/Address\s+([0-9A-Fa-f]{2}):/im);
    if (!addrMatch) continue;

    const addr   = addrMatch[1].toUpperCase();
    const module = result.modules.find(m => m.address === addr);
    if (!module) continue;

    // Unreachable modules — two possible VCDS messages
    if (/Cannot be reached|No Response/i.test(block)) {
      module.status = 'Cannot be reached';
      continue;
    }

    const bLines = block.split('\n').map(l => l.trim()).filter(Boolean);

    // ── Module metadata fields
    for (const line of bLines) {
      if (line.startsWith('Component:') && !module.component)
        module.component = line.replace('Component:', '').trim();

      if (line.startsWith('Part No SW:')) {
        // "Part No SW: 1K0 906 032 S   HW: 06K 907 309 B"
        const p = line.match(/Part No SW:\s*(.+?)(?:\s{2,}HW:\s*(.+))?$/);
        if (p) {
          module.partNoSW = p[1].trim();
          if (p[2]) module.partNoHW = p[2].trim();
        }
      }

      if (line.startsWith('Coding:') && !module.coding)
        module.coding = line.replace('Coding:', '').trim();

      if (line.startsWith('Shop #:') && !module.shopNo)
        module.shopNo = line.replace('Shop #:', '').trim();

      if (line.startsWith('VCID:') && !module.vcid)
        module.vcid = line.replace('VCID:', '').trim();
    }

    // ── Check for faults
    const faultCountMatch = block.match(/(\d+)\s+Fault[s]?\s+Found:/i);
    if (!faultCountMatch || parseInt(faultCountMatch[1]) === 0) continue;

    let inFaultSection = false;
    let currentFault   = null;
    let inFreezeFrame  = false;

    for (const line of bLines) {
      // Enter fault section
      if (/^\d+\s+Fault[s]?\s+Found:/i.test(line)) {
        inFaultSection = true;
        continue;
      }
      if (!inFaultSection) continue;

      // ── New fault entry: 5–7 digit VAG code + dash + description
      // Examples:
      //   "17100 - Transmission Input Speed Sensor (G182)"
      //   "3281987 - Powertrain Bus Off"
      const fm = line.match(/^(\d{5,7})\s+-\s+(.+)/);
      if (fm) {
        if (currentFault) _pushFault(module, currentFault);
        currentFault = {
          code:         fm[1],
          description:  fm[2].trim(),
          pCode:        '',
          detail:       '',
          flags:        '',
          faultStatus:  '',
          frequency:    0,
          priority:     0,
          resetCounter: 0,
          mileage:      '',
          date:         '',
          time:         '',
          freezeFrame:  {}
        };
        inFreezeFrame = false;
        continue;
      }

      if (!currentFault) continue;

      // ── P/U/B/C code — classic format: "P0716 - 000 - Implausible Signal"
      const classicPx = /^(P|U|B|C)[0-9A-Fa-f]{4}\s+-\s+\d{3}\s+-\s+(.*)/;
      const cp = line.match(classicPx);
      if (cp && !inFreezeFrame) {
        currentFault.pCode  = line.split(/\s+/)[0];
        if (cp[2].trim()) currentFault.detail = cp[2].trim();
        continue;
      }

      // ── UDS extended format: "U1113 00 [00001000] - -"
      //    or just "P17F9 08 [08100000]"
      if (!inFreezeFrame && /^(P|U|B|C)[0-9A-Fa-f]{4}\s+[0-9A-Fa-f]+/.test(line)) {
        currentFault.pCode = line.split(/\s+/)[0];
        continue;
      }

      // ── Fault metadata (before Freeze Frame)
      if (!inFreezeFrame) {
        if (/^Fault Status:/i.test(line)) {
          currentFault.faultStatus = line.replace(/^Fault Status:\s*/i, '').trim();
          continue;
        }
        if (/^Fault Frequency:/i.test(line)) {
          currentFault.frequency = parseInt(line.replace(/^Fault Frequency:\s*/i, '')) || 0;
          continue;
        }
        if (/^Fault Priority:/i.test(line)) {
          currentFault.priority = parseInt(line.replace(/^Fault Priority:\s*/i, '')) || 0;
          continue;
        }
        if (/^Reset Counter:/i.test(line)) {
          currentFault.resetCounter = parseInt(line.replace(/^Reset Counter:\s*/i, '')) || 0;
          continue;
        }

        // ── Status flags: "Intermittent - Confirmed - Tested Since Memory Clear"
        //    First word is one of these known status tokens
        if (/^(Intermittent|Confirmed|Static|Present|Stored|Pending|Not\s+Confirmed)/i.test(line) && line.includes(' - ')) {
          currentFault.flags = line;
          continue;
        }

        // ── Old-style numeric detail: "010 - Open or Short to Plus"
        if (!currentFault.detail && /^\d{3}\s+-\s+.+/.test(line) && line.length < 100) {
          currentFault.detail = line.replace(/^\d+\s+-\s+/, '').trim();
          continue;
        }
      }

      // ── Freeze Frame section
      if (line === 'Freeze Frame:') {
        inFreezeFrame = true;
        continue;
      }

      if (inFreezeFrame) {
        const kv = line.match(/^(.+?):\s+(.+)/);
        if (kv) {
          const key = kv[1].trim();
          const val = kv[2].trim();
          currentFault.freezeFrame[key] = val;
          if (/^Mileage$/i.test(key)) currentFault.mileage = val;
          if (/^Date$/i.test(key))    currentFault.date    = val;
          if (/^Time$/i.test(key))    currentFault.time    = val;
        }
      }
    }

    if (currentFault) _pushFault(module, currentFault);
  }

  result.totalFaults = result.modules.reduce((s, m) => s + m.faults.length, 0);
  return result;
}

/** Dedup: same numeric code + pCode in the same module = skip */
function _pushFault(module, fault) {
  const exists = module.faults.find(
    f => f.code === fault.code && f.pCode === fault.pCode
  );
  if (!exists) module.faults.push(fault);
}
