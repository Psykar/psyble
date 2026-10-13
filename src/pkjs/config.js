function calendar(n, color) {
  return [
    {
      type: 'input',
      messageKey: 'CAL_URL[' + n + ']',
      label: 'Calendar ' + (n + 1) + ' iCal address',
      attributes: { type: 'url', placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics' }
    },
    {
      type: 'color',
      messageKey: 'CAL_COLOR[' + n + ']',
      label: 'Calendar ' + (n + 1) + ' colour',
      defaultValue: color,
      sunlight: false
    }
  ];
}

module.exports = [
  { type: 'heading', defaultValue: 'Psyble' },
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Look' },
      {
        type: 'select',
        messageKey: 'THEME',
        label: 'Dial',
        defaultValue: '1',
        options: [{ label: 'Teal', value: '1' }, { label: 'Black', value: '0' }]
      },
      {
        type: 'color',
        messageKey: 'ACCENT',
        label: 'Accent',
        defaultValue: 'FFAA00',
        sunlight: false
      },
      {
        type: 'select',
        messageKey: 'COUNTDOWN_AT',
        label: 'Countdown to next event',
        defaultValue: '0',
        options: [
          { label: 'On the event card', value: '0' },
          { label: 'Next to the event', value: '2' },
          { label: 'Next to the chevron', value: '1' },
          { label: 'Off', value: '3' }
        ]
      },
      {
        type: 'toggle',
        messageKey: 'HAND_REACH',
        label: 'Stretch hands to the screen edge',
        defaultValue: false,
        capabilities: ['RECT']
      }
    ]
  },
  {
    type: 'section',
    items: [{ type: 'heading', defaultValue: 'Calendar' }, {
      type: 'text',
      defaultValue: 'Paste each calendar\'s private iCal address. In Google Calendar: Settings → the calendar → ' +
        'Integrate calendar → Secret address in iCal format. Events for the next 12 hours are shaded round the dial.'
    }].concat(calendar(0, '00AAFF'), calendar(1, '55AA55'), calendar(2, 'FF5500'))
  },
  { type: 'submit', defaultValue: 'Save' }
];
