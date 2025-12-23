// public/js/main.js
document.addEventListener('DOMContentLoaded', function() {
  const checkinDateElem = document.getElementById('check_in_date');
  const checkoutDateElem = document.getElementById('check_out_date');

  // init flatpickr if present
  if (checkinDateElem && checkoutDateElem && typeof flatpickr !== 'undefined') {
    const checkinPicker = flatpickr(checkinDateElem, {
      minDate: "today",
      dateFormat: "Y-m-d",
      onChange: function(selectedDates) {
        if (selectedDates.length > 0) {
          checkoutPicker.set('minDate', selectedDates[0]);
        }
      }
    });

    const checkoutPicker = flatpickr(checkoutDateElem, {
      minDate: "today",
      dateFormat: "Y-m-d",
    });
  }

  const bookingForm = document.getElementById('booking-form');
  const priceEstimateElem = document.getElementById('price-final');
  const priceOriginalElem = document.getElementById('price-original');
  const priceFinalElem = document.getElementById('price-final');
  const roomSelect = document.getElementById('room_id');
  const promoInput = document.getElementById('promo_code');
  const couponMessage = document.getElementById('coupon-message');
  const applyBtn = document.getElementById('apply-coupon');
  const checkinInput = document.getElementById('check_in_date');
  const checkoutInput = document.getElementById('check_out_date');

  function calcNights() {
    const ci = new Date(checkinInput.value);
    const co = new Date(checkoutInput.value);
    const nights = Math.round((co - ci) / (1000*60*60*24));
    return isNaN(nights) ? 0 : nights;
  }

  function updatePriceDisplay(discountData) {
    const selectedOption = roomSelect && roomSelect.options[roomSelect.selectedIndex];
    if (!selectedOption || !selectedOption.dataset.price) {
      priceOriginalElem.style.display = 'none';
      priceFinalElem.textContent = '$0.00';
      return;
    }

    const pricePerNight = parseFloat(selectedOption.dataset.price);
    const nights = calcNights();
    if (nights <= 0) {
      priceOriginalElem.style.display = 'none';
      priceFinalElem.textContent = '$0.00';
      return;
    }

    const original = (pricePerNight * nights);
    priceOriginalElem.textContent = `$${original.toFixed(2)}`;
    priceOriginalElem.style.display = discountData && discountData.valid ? 'inline' : 'none';

    let final = original;
    if (discountData && discountData.valid) {
      const coupon = discountData.coupon;
      if (coupon.type === 'percent') {
        final = original - (original * coupon.value / 100);
      } else if (coupon.type === 'fixed') {
        final = original - coupon.value;
      }
      if (final < 0) final = 0;
      couponMessage.textContent = `Applied ${promoInput.value.toUpperCase()} — ${coupon.value}${coupon.type === 'percent' ? '%' : ''} off`;
      couponMessage.style.color = '#2e7d32';
    } else {
      couponMessage.textContent = '';
    }

    priceFinalElem.textContent = `$${final.toFixed(2)}`;
  }

  // Live update events
  if (bookingForm) {
    [checkinInput, checkoutInput, roomSelect].forEach(el => {
      if (el) el.addEventListener('change', () => updatePriceDisplay(null));
    });
  }

  // Apply coupon button
  if (applyBtn) {
    applyBtn.addEventListener('click', async () => {
      const code = promoInput.value.trim();
      if (!code) {
        couponMessage.textContent = 'Enter a promo code';
        couponMessage.style.color = '#c62828';
        return;
      }

      // call server to validate coupon
      try {
        const resp = await fetch('/api/validate-coupon', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ code })
        });
        const json = await resp.json();
        if (!json.valid) {
          couponMessage.textContent = 'Invalid coupon';
          couponMessage.style.color = '#c62828';
          updatePriceDisplay(null);
          return;
        }
        // show updated price using coupon info
        updatePriceDisplay({ valid: true, coupon: json.coupon });
      } catch (err) {
        console.error('Coupon validation failed', err);
        couponMessage.textContent = 'Error validating coupon';
        couponMessage.style.color = '#c62828';
      }
    });
  }

  // Handle booking submission
  if (bookingForm) {
    bookingForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(bookingForm);
      const data = Object.fromEntries(formData.entries());
      const responseDiv = document.getElementById('booking-response');

      try {
        const response = await fetch('/api/book', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        const result = await response.json();
        responseDiv.className = 'response-message';
        if (result.success) {
          responseDiv.classList.add('success');
          responseDiv.textContent = 'Booking successful!';
          bookingForm.reset();
          updatePriceDisplay(null);
        } else {
          responseDiv.classList.add('error');
          responseDiv.textContent = 'Error: ' + (result.message || 'Booking failed');
        }
      } catch (error) {
        responseDiv.className = 'response-message error';
        responseDiv.textContent = 'A network error occurred. Please try again.';
        console.error('Submission error:', error);
      }
    });
  }

});
