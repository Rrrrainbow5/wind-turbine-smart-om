# Fault feature library v0.2 (B)

This library is a computation contract, not a claim that every CARE field is a waveform. CARE Version 6 values are ten-minute aggregates and may support trend/statistical analysis only. FFT, STFT, envelope and wavelet outputs require an explicitly supplied high-rate waveform with a positive sampling rate.

## Processing contract

1. Validate `sample_id`, source label, finite one-dimensional values and sampling rate.
2. Remove linear trend and apply a Hann window for transforms in physical units. Record the z-score scale for later model input preparation.
3. Emit mean, variance, standard deviation, RMS, skewness, kurtosis, peak-to-peak, peak and crest factor in the original channel unit. Also return statistics after detrending.
4. Emit Hann-windowed one-sided FFT and STFT power spectral density, analytic-signal envelope spectrum, and energy from a three-level orthonormal Haar wavelet packet. STFT includes time and frequency axes.

## Frequencies

The implementation returns formulas when geometry is incomplete. It does not fabricate Hz values. `1X = shaft_speed_rpm / 60`, `2X = 2 * f_r`, `GMF = gear_teeth * f_r`; bearing formulas require `n`, `d`, `D` and `theta_rad`.

## Model branches

The v0.2 integration shape reserves three branches: engineering features + XGBoost, raw waveform + 1D-CNN/TCN, and time-frequency image + lightweight CNN. Until labelled, grouped data are available, `model.status` remains `NOT_INFERRED`; robust-z is a baseline only. The simulator is an illustrative coupled signal model, not a validated physical model.
