/**
 * Personality page dials (CCB-S4-029).
 *
 * The value readout and the band guidance follow the slider as it moves, so an operator
 * can see what a value MEANS before saving it rather than after talking to her. The band
 * text is not duplicated here: it is read from `data-personality-bands`, which the server
 * renders from the same table the conversation prompt is built from.
 *
 * Progressive enhancement only. With this file blocked the sliders still submit and still
 * save; the readout simply stops following the thumb.
 */
(function () {
  'use strict';

  function guidanceFor(bands, value) {
    for (var i = 0; i < bands.length; i++) {
      if (value <= bands[i][0]) return bands[i][1];
    }
    return bands.length > 0 ? bands[bands.length - 1][1] : '';
  }

  function wire(axis) {
    var slider = axis.querySelector('input[type="range"]');
    var output = axis.querySelector('[data-personality-value]');
    var guidance = axis.querySelector('[data-personality-guidance]');
    if (!slider) return;

    var bands = [];
    try {
      bands = JSON.parse(slider.getAttribute('data-personality-bands') || '[]');
    } catch (error) {
      // A malformed band table must not take the slider down with it: the number still
      // follows the thumb, only the sentence under it stops changing.
      bands = [];
    }

    function update() {
      var value = Number(slider.value);
      if (output) output.textContent = String(value);
      if (guidance && bands.length > 0) guidance.textContent = guidanceFor(bands, value);
    }

    slider.addEventListener('input', update);
    update();
  }

  function init() {
    var axes = document.querySelectorAll('[data-personality-axis]');
    for (var i = 0; i < axes.length; i++) wire(axes[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
