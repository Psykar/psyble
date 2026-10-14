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
        type: 'color',
        messageKey: 'DIAL',
        label: 'Dial',
        description: 'Hands and text are white, so darker colours read best.',
        defaultValue: '005555',
        sunlight: false
      },
      {
        type: 'toggle',
        messageKey: 'TICK_AUTO',
        label: 'Automatic tick colour',
        description: 'Pale yellow, or white on black and grey dials.',
        defaultValue: true
      },
      {
        type: 'color',
        messageKey: 'TICK',
        label: 'Tick colour',
        defaultValue: 'FFFFAA',
        sunlight: false
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
        type: 'select',
        messageKey: 'SHAKE_SECONDS',
        label: 'Second hand after a shake',
        defaultValue: '30',
        options: [
          { label: 'Off', value: '0' },
          { label: 'For 10 seconds', value: '10' },
          { label: 'For 30 seconds', value: '30' },
          { label: 'For a minute', value: '60' }
        ]
      },
      {
        type: 'toggle',
        messageKey: 'BT_VIBE',
        label: 'Buzz when the phone disconnects',
        description: 'Not during Quiet Time.',
        defaultValue: false
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
    }, {
      type: 'select',
      messageKey: 'REFRESH_MINUTES',
      label: 'Check calendars',
      description: 'Google calendars download only the next day; other calendars download in full each check.',
      defaultValue: '30',
      options: [
        { label: 'Every 15 minutes', value: '15' },
        { label: 'Every 30 minutes', value: '30' },
        { label: 'Every hour', value: '60' },
        { label: 'Every 2 hours', value: '120' }
      ]
    }].concat(calendar(0, '00AAFF'), calendar(1, '55AA55'), calendar(2, 'FF5500'))
  },
  { type: 'submit', defaultValue: 'Save' }
];
