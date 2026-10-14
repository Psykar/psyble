// Runs inside the settings page (Clay serialises this function into it), so it can't use
// anything from the surrounding module.
module.exports = function () {
  var clay = this;
  clay.on(clay.EVENTS.AFTER_BUILD, function () {
    var auto = clay.getItemByMessageKey('TICK_AUTO');
    var tick = clay.getItemByMessageKey('TICK');
    function update() {
      if (auto.get()) tick.hide();
      else tick.show();
    }
    auto.on('change', update);
    update();
  });
};
