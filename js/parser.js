/**
 * VCDS .txt log parser
 * Handles full-scan export format from VCDS Windows software.
 */
function parseVCDS(rawText) {
  const result = {
    scanDate: '',
    scanTimestamp: 0,
    vcdsVersion: '',
    vin: '',
    mileage: 0,
    chassisType: '',
    modules: [],
    totalFaults: 0
  };

  const lines = rawText.split('\n');

  // ── Date from first line: Thursday,30,April,2026,19:23:25:00009
  const firstLine = (lines[0] || '').trim();
  const dateParts = firstLine.split(',');
  if (dateParts.length >= 5) {
    const monthMap = {
      January:0, February:1, March:2, April:3, May:4, June:5,
      July:6, August:7, September:8, October:9, November:10, December:11
    };
    const day   = parseInt(dateParts[1]);
    const month = monthMap[dateParts[2]] ?? 0;
    const year  = parseInt(dateParts[3]);
    const tp    = (dateParts[4] || '').split(':');
    result.scanTimestamp = new Date(year, month, day, parseInt(tp[0]||0), parseInt(tp[1]||0), parseInt(tp[2]||0)).getTime();
    result.scanDate = `${dateParts[1]} ${dateParts[2]} ${dateParts[3]}`;
  }

  // ── Header fields
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('VCDS Version:'))
      result.vcdsVersion = line.replace('VCDS Version:', '').trim();
    if (line.startsWith('Chassis Type:'))
      result.chassisType = line.replace('Chassis Type:', '').trim();
    if (line.startsWith('VIN:') && line.includes('Mileage:')) {
      const vm = line.match(/VIN:\s*(\S+)/);
      const mm = line.match(/Mileage:\s*(\d+)km/);
      if (vm) result.vin = vm[1];
      if (mm) result.mileage = parseInt(mm[1]);
    }
    if (line.startsWith('VIN:') && !line.includes('Mileage:') && !result.vin) {
      const vm = line.match(/VIN:\s*(\S+)/);
      if (vm && vm[1].length > 5) result.vin = vm[1];
    }
  }

  // ── Module summary table (before the dashed blocks)
  const summaryRx = /^([0-9A-Fa-f]{2})-(.+?)\s*--\s*Status:\s*(\w[\w\s]*)(\d{4})$/;
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
          faults:     []
        });
      }
    }
  }

  // ── Split into address blocks by separator lines (30+ dashes)
  const sepRx = /^-{30,}$/;
  const blocks = [];
  let current = [];
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

    if (/Cannot be reached/i.test(block)) {
      module.status = 'Cannot be reached';
      continue;
    }

    const bLines = block.split('\n').map(l => l.trim()).filter(Boolean);

    // Module metadata
    for (const line of bLines) {
      if (line.startsWith('Component:'))
        module.component = line.replace('Component:', '').trim();
      if (line.startsWith('Part No SW:')) {
        const p = line.match(/Part No SW:\s*(.+?)(?:\s{2,}HW:\s*(.+))?$/);
        if (p) { module.partNoSW = p[1].trim(); if (p[2]) module.partNoHW = p[2].trim(); }
      }
      if (line.startsWith('Coding:') && !module.coding)
        module.coding = line.replace('Coding:', '').trim();
    }

    // Check if there are faults
    const faultCountMatch = block.match(/(\d+)\s+Fault[s]?\s+Found:/i);
    if (!faultCountMatch || parseInt(faultCountMatch[1]) === 0) continue;

    // Parse fault entries
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

      // New fault: numeric code + dash + description
      // e.g. "17100 - Transmission Input Speed Sensor (G182)"
      const faultRx = /^(\d+)\s+-\s+(.+)/;
      const fm = line.match(faultRx);
      if (fm) {
        if (currentFault) _pushFault(module, currentFault);
        currentFault = {
          code:        fm[1],
          description: fm[2].trim(),
          pCode:       '',
          detail:      '',
          flags:       '',
          mileage:     '',
          date:        '',
          time:        '',
          freezeFrame: {}
        };
        inFreezeFrame = false;
        continue;
      }

      if (!currentFault) continue;

      // P/U/B/C code — classic: "P0716 - 000 - Implausible Signal"
      const classicPx = /^(P|U|B|C)[0-9A-Fa-f]{4}\s+-\s+\d+\s+-\s*(.*)/;
      const cp = line.match(classicPx);
      if (cp && !inFreezeFrame) {
        currentFault.pCode  = line.split(/\s+/)[0];
        currentFault.detail = cp[2].trim();
        continue;
      }

      // UDS extended: "U1113 00 [00001000] - -"
      const udsPx = /^(P|U|B|C)[0-9A-Fa-f]{4}\s+[0-9A-Fa-f]+/;
      if (udsPx.test(line) && !inFreezeFrame) {
        currentFault.pCode = line.split(/\s+/)[0];
        continue;
      }

      // Status flags line: "Intermittent - Confirmed - Tested Since Memory Clear"
      if (!inFreezeFrame && /^(Intermittent|Confirmed|Static|Present|Stored)/i.test(line) && line.includes(' - ')) {
        currentFault.flags = line;
        continue;
      }

      // "010 - Open or Short to Plus" (old-style detail line)
      if (!inFreezeFrame && !currentFault.detail && /^\d+\s+-\s+.+/.test(line) && line.length < 80) {
        currentFault.detail = line.replace(/^\d+\s+-\s+/, '').trim();
        continue;
      }

      // Freeze frame start
      if (line === 'Freeze Frame:') {
        inFreezeFrame = true;
        continue;
      }

      // Freeze frame key: value
      if (inFreezeFrame) {
        const kv = line.match(/^(.+?):\s+(.+)/);
        if (kv) {
          const key = kv[1].trim();
          const val = kv[2].trim();
          currentFault.freezeFrame[key] = val;
          if (key === 'Mileage')   currentFault.mileage = val;
          if (key === 'Date')      currentFault.date    = val;
          if (key === 'Time')      currentFault.time    = val;
        }
      }
    }

    if (currentFault) _pushFault(module, currentFault);
  }

  result.totalFaults = result.modules.reduce((s, m) => s + m.faults.length, 0);
  return result;
}

function _pushFault(module, fault) {
  // Avoid exact duplicate (same code already pushed)
  if (!module.faults.find(f => f.code === fault.code && f.pCode === fault.pCode)) {
    module.faults.push(fault);
  }
}
