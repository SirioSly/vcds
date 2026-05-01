/**
 * VCDS Mechanic Dashboard — Seed de Modificações do Jetta Stage 3
 * ─────────────────────────────────────────────────────────────────
 * COMO USAR:
 * 1. Abra o site e configure o token GitHub
 * 2. Crie o carro "Leonardo — Jetta TSI 2.0" e selecione-o
 * 3. Abra o console do browser (F12 → Console)
 * 4. Cole e execute todo este bloco
 *
 * O script usa o estado global do app (activeCarId, activeCarMods)
 * e grava diretamente no GitHub via ghPut — exige carro selecionado.
 */
(async function () {
  if (typeof activeCarId === 'undefined' || !activeCarId) {
    console.error('❌ Nenhum carro selecionado. Abra um carro primeiro.');
    return;
  }
  if (typeof ghPut === 'undefined') {
    console.error('❌ App não carregado corretamente.');
    return;
  }

  const seedIds = new Set((activeCarMods || []).map(m => m.id));

  const entries = [
    /* ── JÁ VINHA NO CARRO — Pacote na compra (julho/2025) ─────── */
    {
      id: 'seed_001',
      date: '2025-07-01',
      category: 'Performance',
      value: 12000,
      title: 'Embreagem reforçada',
      notes: 'Alta performance para suportar torque do Stage 3. Já vinha no carro na compra.',
      createdAt: new Date('2025-07-01').getTime()
    },
    {
      id: 'seed_002',
      date: '2025-07-01',
      category: 'Motor',
      value: 25000,
      title: 'Mecatrônica DSG6 trocada',
      notes: 'Câmbio DSG6 (02E) com mecatrônica recondicionada. SW: 02E 300 058 N / HW: 02E 927 770 AL. Já vinha no carro.',
      createdAt: new Date('2025-07-01').getTime()
    },
    {
      id: 'seed_003',
      date: '2025-07-01',
      category: 'Performance',
      value: 0,
      title: 'Turbina 49x49 aftermarket',
      notes: 'Turbina aftermarket de maior fluxo para Stage 3. Valor incluso no pacote da compra (R$ 65.800).',
      createdAt: new Date('2025-07-01').getTime()
    },
    {
      id: 'seed_004',
      date: '2025-07-01',
      category: 'Performance',
      value: 0,
      title: 'Escape full aftermarket',
      notes: 'Sistema de escapamento completo (downpipe + catback). Valor incluso no pacote da compra.',
      createdAt: new Date('2025-07-01').getTime()
    },
    {
      id: 'seed_005',
      date: '2025-07-01',
      category: 'Motor',
      value: 0,
      title: 'Bico (injetor) + bomba de tanque',
      notes: 'Injetores e bomba de combustível atualizados para demanda do Stage 3. Incluso no pacote.',
      createdAt: new Date('2025-07-01').getTime()
    },
    {
      id: 'seed_006',
      date: '2025-07-01',
      category: 'Performance',
      value: 0,
      title: 'Mapas motor + câmbio (remap original)',
      notes: 'ECU Simos 12.2 (HW: 06K 907 425 / SW: 06K 906 070 L). CVN 83EACA4C confirma remap não-stock. Incluso no pacote.',
      createdAt: new Date('2025-07-01').getTime()
    },
    {
      id: 'seed_007',
      date: '2025-07-01',
      category: 'Suspensão',
      value: 0,
      title: 'Suspensão + buchas + mola Ibec',
      notes: 'Revisão completa de suspensão com buchas novas e mola esportiva Ibec. Incluso no pacote.',
      createdAt: new Date('2025-07-01').getTime()
    },
    {
      id: 'seed_008',
      date: '2025-07-01',
      category: 'Elétrica',
      value: 0,
      title: 'FuelTech nano',
      notes: 'Módulo de gerenciamento/monitoramento FuelTech nano instalado. Incluso no pacote.',
      createdAt: new Date('2025-07-01').getTime()
    },
    {
      id: 'seed_009',
      date: '2025-07-01',
      category: 'Estética',
      value: 0,
      title: 'Rodas Carbon + farol traseiro',
      notes: 'Rodas Carbon e farol traseiro aftermarket. Incluso no pacote.',
      createdAt: new Date('2025-07-01').getTime()
    },
    {
      id: 'seed_010',
      date: '2025-07-01',
      category: 'Outro',
      value: 28800,
      title: 'Demais itens do pacote na compra',
      notes: 'Valor residual do pacote de modificações (R$ 65.800 − R$ 12.000 embreagem − R$ 25.000 mecatrônica). Cobre turbina, escape, bico, bomba, mapas, suspensão, mola, rodas, farol, FuelTech e reparos gerais.',
      createdAt: new Date('2025-07-01').getTime()
    },
    /* ── PÓS-COMPRA — Setembro/2025 ─────────────────────────────── */
    {
      id: 'seed_011',
      date: '2025-09-01',
      category: 'Manutenção',
      value: 8880,
      title: '1ª Manutenção geral (set/2025)',
      notes: 'Troca de óleo motor, validação DSG, inspeção da corrente de comando e demais reparos. Mecânico avaliou DSG como OK — códigos P0716/P0868/P1741 normais para remap agressivo Stage 3.',
      createdAt: new Date('2025-09-01').getTime()
    },
    {
      id: 'seed_012',
      date: '2025-09-01',
      category: 'Performance',
      value: 2500,
      title: 'Remap Stage 3 — motor + câmbio',
      notes: 'Remapeamento ECU Simos 12.2 e DSG6. CVN: 83EACA4C. Combustível obrigatório: Shell V-Power Podium. Próxima revisão: junho/2026 (óleo motor + óleo DSG + revisão geral).',
      createdAt: new Date('2025-09-01').getTime()
    }
  ];

  const toAdd = entries.filter(e => !seedIds.has(e.id));
  if (toAdd.length === 0) {
    console.log('%c✅ Todas as modificações já existem para este carro.', 'color:#22d3a0;font-weight:bold');
    return;
  }

  // Merge into activeCarMods
  toAdd.forEach(m => activeCarMods.push(m));

  console.log(`%c⏳ Salvando ${toAdd.length} modificações no GitHub...`, 'color:#5b8ef8');
  try {
    await ghPut(
      `data/cars/${activeCarId}/mods.json`,
      activeCarMods,
      `Seed ${toAdd.length} mods for Jetta Stage 3`
    );

    const total = activeCarMods.reduce((s, m) => s + (m.value || 0), 0);
    const fmt = v => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

    console.log(`%c✅ ${toAdd.length} modificações adicionadas com sucesso!`, 'color:#22d3a0;font-weight:bold;font-size:14px');
    console.log(`%c💰 Total investido: ${fmt(total)}`, 'color:#5b8ef8;font-weight:bold');

    // Refresh UI
    if (typeof renderModScreen === 'function') {
      renderModScreen();
      updateModsBadge();
    }
    if (typeof showToast === 'function') showToast(`${toAdd.length} modificações importadas!`, 'ok');

    console.log('Abra a tela Modificações para ver os dados.');
  } catch(e) {
    console.error('❌ Erro ao salvar:', e.message);
  }
})();
