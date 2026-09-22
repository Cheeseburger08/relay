export function sampleState() {
  const now = Date.now();
  const people = [
    ["c1", "Nora Ellis", "+12025550101", 1],
    ["c2", "Oliver Chen", "+12025550102", 2],
    ["c3", "Maya Brooks", "+12025550103", 1],
    ["c4", "Alex Morgan", "+12025550104", 2],
  ];
  const texts = [
    ["c1", "incoming", "Hey! Did you get a chance to look at the photos?", 42],
    ["c1", "outgoing", "I did. The one by the lake is my favorite.", 38],
    ["c1", "incoming", "Mine too! We should go back when you visit.", 35],
    ["c1", "incoming", "Are you free for a catch-up this weekend?", 8],
    ["c2", "outgoing", "Thanks for checking on everything back home.", 95],
    ["c2", "incoming", "Of course. Everything is taken care of.", 70],
    ["c3", "incoming", "Your book arrived. I will keep it here for you.", 180],
    ["c4", "incoming", "Saturday works for me. Talk soon!", 1440],
  ];
  return {
    conversations: people.map(([id, name, number, sim], i) => ({
      id,
      name,
      number,
      sim,
      pinned: i === 0,
      archived: false,
    })),
    contacts: people.map(([id, name, number]) => ({
      id: "contact-" + id,
      name,
      number,
    })),
    messages: texts.map(([conversationId, direction, text, minutes], i) => ({
      id: "m" + i,
      conversationId,
      direction,
      text,
      createdAt: now - minutes * 60000,
      sim: people.find((p) => p[0] === conversationId)[3],
      status: "sample",
      unread: i === 3 || i === 5,
    })),
    calls: [
      {
        id: "call1",
        number: people[0][2],
        direction: "missed",
        sim: 1,
        duration: 0,
        createdAt: now - 3600000,
      },
      {
        id: "call2",
        number: people[1][2],
        direction: "outgoing",
        sim: 2,
        duration: 184,
        createdAt: now - 7200000,
      },
      {
        id: "call3",
        number: people[2][2],
        direction: "incoming",
        sim: 1,
        duration: 62,
        createdAt: now - 86400000,
      },
    ],
    device: {
      name: "Xperia XZ",
      model: "F8332",
      battery: 82,
      online: false,
      sample: true,
      smsReady: false,
      sims: [
        { slot: 1, label: "Personal", available: false },
        { slot: 2, label: "Second line", available: false },
      ],
    },
    capabilities: { liveCalls: false, push: false },
  };
}
