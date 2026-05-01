/**
 * VCDS Dashboard — Seed de Modificações do Jetta Stage 3
 * Cole este bloco inteiro no console do browser (F12 → Console)
 * com o site aberto. Só adiciona o que ainda não existe.
 */
(function () {
  const KEY = 'vcds_jetta_mods';
  const existing = JSON.parse(localStorage.getItem(KEY) || '[]');
  const seedIds  = new Set(existing.map(m => m.id));

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
      notes: 'Valor residual do pacote de modificações na compra (R$ 65.800 total − R$ 12.000 embreagem − R$ 25.000 mecatrônica). Cobre: turbina, escape, bico, bomba, mapas, suspensão, mola, rodas, farol, FuelTech e reparos gerais.',
      createdAt: new Date('2025-07-01').getTime()
    },
    /* ── PÓS-COMPRA — Setembro/2025 ─────────────────────────────── */
    {
      id: 'seed_011',
      date: '2025-09-01',
      category: 'Manutenção',
      value: 8880,
      title: '1ª Manutenção geral (set/2025)',
      notes: 'Troca de óleo motor, validação DSG, inspeção da corrente de comando e demais reparos. Mecânico avaliou DSG como OK — códigos P0716/P0868/P1741 são normais para remap agressivo Stage 3.',
      createdAt: new Date('2025-09-01').getTime()
    },
    {
      id: 'seed_012',
      date: '2025-09-01',
      category: 'Performance',
      value: 2500,
      title: 'Remap Stage 3 — motor + câmbio',
      notes: 'Remapeamento profissional ECU Simos 12.2 e DSG6. CVN resultante: 83EACA4C. Combustível obrigatório: Shell V-Power Podium (alta octanagem). Próxima revisão: junho/2026 (óleo motor + óleo câmbio DSG).',
      createdAt: new Date('2025-09-01').getTime()
    }
  ];

  const toAdd = entries.filter(e => !seedIds.has(e.id));
  const merged = [...existing, ...toAdd];
  localStorage.setItem(KEY, JSON.stringify(merged));

  const total = merged.reduce((s, m) => s + (m.value || 0), 0);
  const fmt = v => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

  console.log(`%c✅ ${toAdd.length} modificações adicionadas (${entries.length - toAdd.length} já existiam)`, 'color:#22d3a0;font-weight:bold');
  console.log(`%c💰 Total investido: ${fmt(total)}`, 'color:#5b8ef8;font-weight:bold');
  console.log('Recarregando...');
  setTimeout(() => location.reload(), 800);
})();
