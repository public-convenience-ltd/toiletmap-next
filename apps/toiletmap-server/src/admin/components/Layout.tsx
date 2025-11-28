import { html } from 'hono/html';

export const Layout = (props: { title: string; children: unknown }) => {
  return html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${props.title} - Toilet Map Admin</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link
          href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css"
          crossorigin="anonymous"
          referrerpolicy="no-referrer"
        />
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
          crossorigin=""
        />

        <style>
          :root {
            /* Colors */
            --color-primary-navy: #0a165e;
            --color-accent-turquoise: #92f9db;
            --color-accent-pink: #ed3d62;
            --color-frost-ice: #d2fff2;
            --color-base-white: #ffffff;
            --color-light-grey: #f4f4f4;
            --color-neutral-grey: #807f7f;
            --color-aqua-accent: #93f9db;
            --color-blue: var(--color-primary-navy);
            --color-turquoise: var(--color-accent-turquoise);
            --color-pink: var(--color-accent-pink);
            --color-white: var(--color-base-white);

            /* Spacing */
            --space-3xs: clamp(0.25rem, calc(0.23rem + 0.11vw), 0.31rem);
            --space-2xs: clamp(0.5rem, calc(0.48rem + 0.11vw), 0.56rem);
            --space-xs: clamp(0.75rem, calc(0.71rem + 0.22vw), 0.88rem);
            --space-s: clamp(1rem, calc(0.96rem + 0.22vw), 1.13rem);
            --space-m: clamp(1.5rem, calc(1.43rem + 0.33vw), 1.69rem);
            --space-l: clamp(2rem, calc(1.91rem + 0.43vw), 2.25rem);
            --space-xl: clamp(3rem, calc(2.87rem + 0.65vw), 3.38rem);
            --space-2xl: clamp(4rem, calc(3.83rem + 0.87vw), 4.5rem);
            --space-3xl: clamp(6rem, calc(5.74rem + 1.3vw), 6.75rem);

            /* Typography */
            --font-family: 'Open Sans', sans-serif;
            --text--2: clamp(0.69rem, calc(0.69rem + 0.04vw), 0.72rem);
            --text--1: clamp(0.83rem, calc(0.81rem + 0.12vw), 0.9rem);
            --text-0: clamp(1rem, calc(0.96rem + 0.22vw), 1.13rem);
            --text-1: clamp(1.2rem, calc(1.13rem + 0.36vw), 1.41rem);
            --text-2: clamp(1.44rem, calc(1.33rem + 0.55vw), 1.76rem);
            --text-3: clamp(1.73rem, calc(1.56rem + 0.82vw), 2.2rem);
            --text-4: clamp(2.07rem, calc(1.84rem + 1.17vw), 2.75rem);
          --text-5: clamp(2.49rem, calc(2.16rem + 1.64vw), 3.43rem);

          /* Layout */
          --toilet-max-width: 1680px;
          --toilet-article-max-width: 75ch;
          --toilet-gutter: var(--space-l);
          --create-action-bar-height: 96px;
          }

          body {
            font-family: var(--font-family);
            line-height: 1.5;
            color: var(--color-primary-navy);
            margin: 0;
            background-color: var(--color-base-white);
          }

          .visually-hidden {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
          }

          /* Header */
          .header { background: var(--color-white); padding-block: var(--space-xs); border-bottom: 1px solid var(--color-light-grey); }
          .header__stack { display: flex; align-items: center; justify-content: space-between; width: 100%; flex-wrap: wrap; gap: var(--space-s); }
          .header__nav { list-style: none; margin: 0; padding: 0; display: flex; gap: var(--space-m); font-weight: 600; flex-wrap: wrap; }
          .header__nav a { text-decoration: none; color: var(--color-primary-navy); }
          .header__nav a:hover { color: var(--color-accent-pink); }

          /* Layout Helpers */
          .center { box-sizing: content-box; margin-inline: auto; max-inline-size: var(--toilet-max-width); }
          .center--gutter { padding-inline: var(--toilet-gutter); }
          
          @media (max-width: 640px) {
            .center--gutter {
              padding-inline: var(--space-s);
            }
            .header__stack {
              flex-direction: column;
              align-items: flex-start;
            }
            .header__nav {
              width: 100%;
              gap: var(--space-s);
            }
          }
          
          /* Button */
          .button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 34px;
            padding: 0 var(--space-s);
            border: 2px solid var(--color-turquoise);
            border-radius: 17px;
            font-weight: bold;
            color: var(--color-blue);
            background-color: var(--color-turquoise);
            text-decoration: none;
            cursor: pointer;
            transition: all 0.2s ease;
          }
          .button:hover { background-color: var(--color-blue); color: var(--color-turquoise); border-color: var(--color-blue); }
          .button--secondary {
            background-color: transparent;
            color: var(--color-primary-navy);
            border-color: rgba(10, 22, 94, 0.35);
          }
          .button--secondary:hover {
            background-color: rgba(10, 22, 94, 0.08);
            color: var(--color-primary-navy);
          }
          
          /* Inputs */
          .input,
          .text-area {
            width: 100%;
            display: block;
            padding: var(--space-xs);
            box-sizing: border-box;
            color: var(--color-blue);
            border: 2px solid var(--color-light-grey);
            border-radius: 8px;
            font-family: inherit;
            font-size: var(--text-0);
            transition: all 0.2s ease;
            background: var(--color-white);
          }
          .input:hover,
          .text-area:hover {
            border-color: var(--color-aqua-accent);
          }
          .input:focus,
          .text-area:focus {
            outline: none;
            border-color: var(--color-primary-navy);
            box-shadow: 0 0 0 3px rgba(10, 22, 94, 0.1);
          }
          .input {
            margin-top: var(--space-3xs);
          }
          .text-area {
            resize: vertical;
            min-height: 100px;
          }
          
          /* Form labels */
          .form-label {
            font-weight: 600;
            color: var(--color-primary-navy);
            font-size: var(--text-0);
          }
          
          /* Form errors */
          .form-error {
            display: block;
            color: var(--color-accent-pink);
            font-size: var(--text--1);
            font-weight: 600;
            margin-top: var(--space-2xs);
            padding-left: var(--space-xs);
            border-left: 3px solid var(--color-accent-pink);
          }
          
          /* Section headings */
          h2 {
            font-size: var(--text-2);
            font-weight: 700;
            color: var(--color-primary-navy);
            margin: 0 0 var(--space-m) 0;
          }
          
          /* Tri-state toggle - slimline & elegant */
          .tri-state-container {
            display: inline-flex;
            background: var(--color-light-grey);
            border-radius: 20px;
            padding: 3px;
            gap: 2px;
          }
          .tri-state-option {
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.15s ease;
            position: relative;
          }
          .tri-state-option:hover .tri-state-label {
            color: var(--color-primary-navy);
          }
          .tri-state-option input[type="radio"] {
            position: absolute;
            opacity: 0;
            pointer-events: none;
            width: 0;
            height: 0;
          }
          .tri-state-label {
            padding: var(--space-2xs) var(--space-s);
            border-radius: 17px;
            transition: all 0.15s ease;
            font-size: var(--text--1);
            font-weight: 500;
            color: var(--color-neutral-grey);
            white-space: nowrap;
          }
          .tri-state-option input[type="radio"]:checked + .tri-state-label {
            background: var(--color-turquoise);
            color: var(--color-primary-navy);
            font-weight: 700;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
          }

          /* Data layout */
          .page-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: var(--space-m);
            margin-bottom: var(--space-l);
            flex-wrap: wrap;
          }

          .stats-panel {
            border: 1px solid #e4e4e7;
            border-radius: 16px;
            background: var(--color-white);
            padding: 0;
            margin-bottom: var(--space-l);
            transition: all 0.3s ease;
            overflow: hidden;
          }
          .stats-panel__header {
            padding: var(--space-s) var(--space-m);
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-m);
            background: var(--color-white);
            border-bottom: 1px solid transparent;
            transition: border-color 0.3s ease;
            flex-wrap: wrap;
          }
          .stats-panel:not(.stats-panel--collapsed) .stats-panel__header {
            border-bottom-color: #e4e4e7;
          }
          .stats-panel__content {
            padding: var(--space-m);
          }
          .stats-panel--collapsed .stats-panel__content {
            display: none;
          }
          .stats-summary {
            font-weight: 600;
            color: var(--color-primary-navy);
            font-size: var(--text-0);
            flex: 1 1 200px;
            min-width: 200px;
          }
          .stats-toggle {
            background: none;
            border: none;
            color: var(--color-primary-navy);
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: var(--space-2xs);
            padding: var(--space-2xs) var(--space-xs);
            border-radius: 8px;
            transition: background 0.2s;
            font-size: var(--text--1);
          }
          .stats-toggle:hover {
            background: var(--color-light-grey);
          }
          .stats-toggle i {
            color: var(--color-primary-navy);
          }

          .collapsible {
            position: relative;
          }
          .collapsible__header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: var(--space-s);
            flex-wrap: wrap;
          }
          .collapsible__toggle {
            background: none;
            border: none;
            color: var(--color-primary-navy);
            font-weight: 600;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: var(--space-2xs);
            padding: var(--space-2xs) var(--space-xs);
            border-radius: 8px;
            transition: background 0.2s, color 0.2s;
          }
          .collapsible__toggle:hover {
            background: var(--color-light-grey);
          }
          .collapsible__toggle-icon {
            transition: transform 0.2s ease;
          }
          .collapsible--collapsed .collapsible__toggle-icon {
            transform: rotate(180deg);
          }
          .collapsible__content {
            margin-top: var(--space-m);
          }
          .collapsible--collapsed .collapsible__content {
            display: none;
          }

          .metric-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: var(--space-m);
          }
          .metric-card {
            border: 1px solid #e4e4e7;
            border-radius: 12px;
            padding: var(--space-s);
            background: #fafafa;
          }
          .metric-label {
            font-size: var(--text--1);
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--color-neutral-grey);
          }
          .metric-value {
            font-size: var(--text-2);
            font-weight: 600;
            margin: var(--space-3xs) 0;
            color: var(--color-primary-navy);
          }
          .metric-meta {
            font-size: var(--text--1);
            color: var(--color-neutral-grey);
          }
          .stat-sections {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: var(--space-m);
            margin-top: var(--space-m);
          }
          /* ... existing styles ... */

          .table-controls {
            display: flex;
            flex-direction: column;
            gap: var(--space-s);
            margin-bottom: var(--space-m);
            z-index: 10;
            position: relative;
            background: var(--color-light-grey);
            padding: var(--space-s);
            border-radius: 12px;
          }
          .table-controls__row {
            display: grid;
            gap: var(--space-s);
            grid-template-columns: 1fr;
          }
          .search-form {
            width: 100%;
          }
          .search-form__row {
            display: grid;
            gap: var(--space-s);
            grid-template-columns: 1fr;
          }
          .search-input-wrapper {
            position: relative;
            width: 100%;
            min-width: 0;
            align-self: start;
          }
          .search-input {
            padding-left: calc(var(--space-l) + 0.25rem);
            padding-right: calc(var(--space-l) + 0.25rem);
          }
          .search-input-icon {
            position: absolute;
            left: var(--space-xs);
            top: 50%;
            transform: translateY(-50%);
            color: var(--color-neutral-grey);
            pointer-events: none;
            font-size: 0.95rem;
          }
          .search-clear-btn {
            position: absolute;
            right: var(--space-xs);
            top: 50%;
            transform: translateY(-50%);
            background: none;
            border: none;
            color: var(--color-neutral-grey);
            cursor: pointer;
            padding: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transition: color 0.2s ease;
          }
          .search-clear-btn:hover {
            color: var(--color-primary-navy);
          }
          .search-clear-btn:focus-visible {
            outline: 2px solid var(--color-primary-navy);
            outline-offset: 2px;
          }
          .filter-controls {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            gap: var(--space-xs);
            width: 100%;
            min-width: 0;
          }

          /* Create form layout */
          .create-shell {
            display: flex;
            flex-direction: column;
            gap: var(--space-m);
            margin-bottom: var(--space-l);
          }
          .create-form {
            display: flex;
            flex-direction: column;
            gap: var(--space-m);
            padding-bottom: calc(var(--create-action-bar-height) + var(--space-l));
          }
          .create-layout {
            display: grid;
            grid-template-columns: minmax(0, 2fr) minmax(240px, 1fr);
            gap: var(--space-m);
            align-items: flex-start;
          }
          .create-main,
          .create-side {
            display: flex;
            flex-direction: column;
            gap: var(--space-m);
          }
          @media (max-width: 1024px) {
            .create-layout {
              grid-template-columns: 1fr;
            }
            .create-side {
              flex-direction: row;
              flex-wrap: wrap;
            }
            .create-side > * {
              flex: 1;
              min-width: min(300px, 100%);
            }
          }
          .form-card {
            border: 1px solid #e4e4e7;
            border-radius: 16px;
            background: var(--color-white);
            padding: var(--space-m);
            box-shadow: 0 12px 30px rgba(10, 22, 94, 0.04);
          }
          .form-card--compact {
            padding: var(--space-s);
          }
          .section-header {
            display: flex;
            justify-content: space-between;
            gap: var(--space-s);
            margin-bottom: var(--space-s);
            flex-wrap: wrap;
          }
          .section-eyebrow {
            text-transform: uppercase;
            letter-spacing: 0.08em;
            font-size: var(--text--1);
            color: var(--color-neutral-grey);
            margin: 0 0 var(--space-3xs);
          }
          .section-title {
            margin: 0;
            font-size: var(--text-2);
          }
          .section-description {
            margin: var(--space-3xs) 0 0 0;
            color: var(--color-neutral-grey);
            font-size: var(--text--1);
          }
          .section-body {
            display: flex;
            flex-direction: column;
            gap: var(--space-m);
          }
          .field-grid {
            display: grid;
            gap: var(--space-m);
          }
          .field-grid--two {
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          }
          @media (max-width: 600px) {
            .field-grid--two {
              grid-template-columns: 1fr;
            }
          }
          .form-field {
            display: flex;
            flex-direction: column;
            gap: var(--space-2xs);
          }
          .field-hint {
            margin: 0;
            font-size: var(--text--1);
            color: var(--color-neutral-grey);
          }
          .input--error {
            border-color: var(--color-accent-pink);
          }
          .pill-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: var(--space-s);
          }
          .pill-grid--dense {
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          }
          .create-form .pill-grid {
            grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
          }
          .create-form .pill-grid--dense {
            grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
          }
          .tri-field {
            display: flex;
            flex-direction: column;
            gap: var(--space-2xs);
            border: 0;
            margin: 0;
            padding: 0;
          }
          .tri-field--compact .tri-state-container {
            width: 100%;
          }
          .tri-state-container {
            display: flex;
            width: 100%;
            border: 1px solid rgba(10, 22, 94, 0.12);
            border-radius: 999px;
            background: #f8fafc;
            padding: 4px;
            gap: 4px;
            flex-wrap: wrap;
            row-gap: 6px;
          }
          .tri-state-option {
            flex: 1 1 0;
            position: relative;
            min-width: 0;
          }
          .tri-state-option input[type="radio"] {
            position: absolute;
            inset: 0;
            opacity: 0;
            pointer-events: none;
          }
          .tri-state-option input[type="radio"]:focus-visible + .tri-state-label {
            box-shadow: 0 0 0 2px rgba(146, 249, 219, 0.9);
          }
          .tri-state-label {
            display: inline-flex;
            width: 100%;
            justify-content: center;
            align-items: center;
            padding: var(--space-3xs) var(--space-s);
            border-radius: 999px;
            font-size: var(--text--1);
            font-weight: 600;
            color: var(--color-neutral-grey);
            background: transparent;
            transition: all 0.2s ease;
            border: 1px solid transparent;
            text-align: center;
            white-space: normal;
            line-height: 1.3;
            word-break: break-word;
          }
          .tri-state-label:hover {
            color: var(--color-primary-navy);
          }
          .tri-state-label--active {
            background: var(--color-white);
            color: var(--color-primary-navy);
            border-color: rgba(10, 22, 94, 0.16);
            box-shadow: 0 4px 12px rgba(10, 22, 94, 0.12);
          }
          .form-actions {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: var(--space-m);
            flex-wrap: wrap;
          }
          .form-actions--fixed {
            position: fixed;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 100;
            background: rgba(255, 255, 255, 0.96);
            backdrop-filter: blur(6px);
            border-top: 1px solid #dfe3eb;
            box-shadow: 0 -12px 30px rgba(10, 22, 94, 0.12);
            padding: var(--space-s) var(--toilet-gutter);
            box-sizing: border-box;
            min-height: var(--create-action-bar-height);
          }
          .form-actions__meta {
            margin: 0;
            color: var(--color-neutral-grey);
            font-size: var(--text--1);
          }
          .form-actions__buttons {
            display: flex;
            gap: var(--space-s);
            flex-wrap: wrap;
          }
          .notification {
            display: flex;
            gap: var(--space-s);
            border-radius: 12px;
            padding: var(--space-s);
            border: 1px solid transparent;
            align-items: flex-start;
          }
          .notification--success {
            border-color: rgba(146, 249, 219, 0.5);
            background: #f0fffa;
          }
          .notification--error {
            border-color: rgba(237, 61, 98, 0.3);
            background: #fff5f7;
          }
          .notification--info {
            border-color: rgba(10, 22, 94, 0.15);
            background: #f7f9ff;
          }
          .notification__icon {
            font-size: var(--text-2);
            color: var(--color-primary-navy);
          }
          .notification__content {
            flex: 1;
          }
          .notification__title {
            margin: 0;
            font-weight: 600;
          }
          .notification__message {
            margin: var(--space-3xs) 0 0 0;
          }
          .notification__actions {
            display: flex;
            gap: var(--space-s);
            margin-top: var(--space-s);
            flex-wrap: wrap;
          }
          .create-tips {
            margin: 0;
            padding-left: var(--space-m);
            color: var(--color-neutral-grey);
            font-size: var(--text--1);
            display: flex;
            flex-direction: column;
            gap: var(--space-2xs);
          }
          @media (max-width: 640px) {
            .form-actions--fixed {
              flex-direction: column;
              align-items: flex-start;
            }
            .form-actions__buttons {
              width: 100%;
              justify-content: space-between;
            }
            .form-actions__buttons .button {
              flex: 1;
              text-align: center;
            }
          }

          @media (min-width: 768px) {
            .table-controls__row {
              grid-template-columns: 1fr auto;
              align-items: start;
            }
          }

          @media (min-width: 1024px) {
            .search-form__row {
              grid-template-columns: minmax(320px, 420px) minmax(0, 1fr);
              align-items: start;
            }
          }

          @media (min-width: 1200px) {
             .search-form__row {
              grid-template-columns: minmax(360px, 460px) minmax(0, 1fr);
              align-items: start;
            }
          }

          .active-filters {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-2xs);
            margin-bottom: var(--space-s);
          }

          .filter-chip {
            display: inline-flex;
            align-items: center;
            gap: var(--space-3xs);
            background: #f8fafc;
            border-radius: 999px;
            padding: 0 var(--space-xs);
            height: 32px;
            font-size: var(--text--1);
            color: var(--color-primary-navy);
            border: 1px solid #d4d8dd;
          }
          form.filter-chip {
            margin: 0;
          }
          .filter-chip__label {
            font-weight: 600;
          }
          .filter-chip__remove {
            border: none;
            background: none;
            cursor: pointer;
            color: inherit;
            display: inline-flex;
            align-items: center;
            padding: 0;
          }
          .filter-chip--reset {
            background: var(--color-white);
          }

          .table-overflow {
            overflow-x: auto;
            width: 100%;
            max-width: 100%;
            -webkit-overflow-scrolling: touch;
          }
          .table-shell {
            position: relative;
            min-height: 560px;
          }
          .table-shell table {
            width: 100%;
            transition: opacity 0.2s ease, filter 0.2s ease;
          }
          .table-shell--loading table,
          .table-shell--muted table {
            pointer-events: none;
          }
          .table-shell--loading table {
            opacity: 0.55;
          }
          .table-shell--muted table {
            opacity: 0.2;
            filter: blur(1px);
          }
          .table-overlay {
            position: absolute;
            inset: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: var(--space-xs);
            padding: var(--space-l);
            text-align: center;
            background: rgba(255, 255, 255, 0.9);
            border-radius: 16px;
            backdrop-filter: blur(4px);
            z-index: 2;
          }
          .table-overlay--loading {
            background: rgba(255, 255, 255, 0.85);
          }
          .table-overlay__actions {
            display: inline-flex;
            flex-wrap: wrap;
            gap: var(--space-2xs);
            justify-content: center;
          }
          .table-overlay i {
            font-size: var(--text-2);
            color: var(--color-primary-navy);
          }
          .table-cell-primary strong {
            display: block;
            font-size: var(--text-0);
            font-weight: 600;
          }
          .table-cell-meta {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-3xs);
            color: var(--color-neutral-grey);
            font-size: var(--text--1);
          }
          .table-cell-subtle {
            color: rgba(10, 22, 94, 0.6);
          }
          .meta-pill-group {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-3xs);
            margin-top: var(--space-3xs);
          }
          .meta-pill {
            display: inline-flex;
            align-items: center;
            border-radius: 999px;
            padding: 0 var(--space-3xs);
            height: 22px;
            background: #edf2f7;
            font-size: var(--text--2);
            color: var(--color-primary-navy);
          }
          .detail-stack {
            display: flex;
            flex-direction: column;
            gap: var(--space-3xs);
          }
          .detail-row {
            display: flex;
            justify-content: space-between;
            gap: var(--space-2xs);
            font-size: var(--text--1);
          }
          .detail-label {
            color: var(--color-neutral-grey);
          }
          .detail-value {
            color: var(--color-primary-navy);
            font-weight: 600;
            text-align: right;
          }
          .status-line {
            display: inline-flex;
            align-items: center;
            gap: var(--space-3xs);
            font-weight: 600;
            color: var(--color-primary-navy);
          }
          .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            display: inline-block;
          }
          .status-dot--positive { background: #1b9c85; }
          .status-dot--warning { background: #d97706; }
          .status-dot--negative { background: #dc2626; }
          .status-dot--muted { background: #94a3b8; }
          .muted-text {
            color: var(--color-neutral-grey);
            font-size: var(--text--2);
          }
          .data-table {
            width: 100%;
            border-collapse: collapse;
          }
          .data-table th,
          .data-table td {
            padding: var(--space-s);
            text-align: left;
            border-bottom: 1px solid #edf0f4;
            font-size: var(--text--1);
          }
          .data-table th {
            font-size: var(--text--1);
            font-weight: 600;
            color: var(--color-primary-navy);
            background: #f7f8fb;
          }
          .data-table tr:hover td {
            background: #f8fafc;
          }
          .data-table .sortable a {
            display: inline-flex;
            align-items: center;
            gap: var(--space-3xs);
          }
          .sort-icon {
            color: rgba(10, 22, 94, 0.5);
            margin-left: var(--space-3xs);
          }

          .badge {
            display: inline-flex;
            align-items: center;
            gap: var(--space-3xs);
            border-radius: 8px;
            padding: 0 var(--space-3xs);
            font-size: var(--text--2);
            font-weight: 600;
            text-transform: none;
            height: 22px;
          }
          .badge i {
            font-size: 0.8em;
          }
          .badge--yes {
            background: #e2fbf2;
            color: var(--color-primary-navy);
          }
          .badge--no {
            background: #fde5eb;
            color: var(--color-accent-pink);
          }
          .badge--unknown,
          .badge--neutral {
            background: #edf2f7;
            color: var(--color-primary-navy);
          }

          .empty-state {
            padding: var(--space-2xl);
            text-align: center;
            color: var(--color-neutral-grey);
          }
          .empty-state i {
            font-size: var(--text-4);
            color: var(--color-primary-navy);
            margin-bottom: var(--space-s);
          }
          .async-state {
            text-align: center;
            padding: var(--space-l);
            border: 1px dashed rgba(10, 22, 94, 0.15);
            border-radius: 12px;
            color: var(--color-neutral-grey);
          }
          .async-state--error {
            color: var(--color-accent-pink);
            border-color: rgba(237, 61, 98, 0.35);
          }
          .loading-indicator {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: var(--space-2xs);
          }
          .loading-indicator p {
            margin: 0;
          }
          .loading-spinner {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            border: 3px solid rgba(10, 22, 94, 0.15);
            border-top-color: var(--color-primary-navy);
            animation: spin 0.9s linear infinite;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          @keyframes pulse {
            0% { opacity: 0.6; }
            50% { opacity: 1; }
            100% { opacity: 0.6; }
          }
          .metric-card--loading {
            animation: pulse 1.5s ease-in-out infinite;
          }
          .metric-card--error {
            border: 1px solid rgba(237, 61, 98, 0.4);
            box-shadow: 0 0 0 1px rgba(237, 61, 98, 0.2);
          }

          .pagination {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-s);
            margin-top: var(--space-m);
          }
          .pagination-controls {
            display: inline-flex;
            gap: var(--space-3xs);
          }
          .pagination-dynamic {
            display: inline-flex;
            gap: var(--space-3xs);
          }
          .pagination-btn {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            border: 1px solid rgba(10, 22, 94, 0.15);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            text-decoration: none;
            color: var(--color-primary-navy);
            font-weight: 600;
          }
          .pagination-btn.active,
          .pagination-btn:hover {
            background: var(--color-primary-navy);
            color: var(--color-turquoise);
            border-color: var(--color-primary-navy);
          }
          .page-size-selector select {
            border-radius: 12px;
            border: 1px solid rgba(10, 22, 94, 0.15);
            padding: var(--space-3xs) var(--space-xs);
          }
          
          /* Feature List Styling */
          .stat-progress-list {
             list-style: none;
             padding: 0;
             margin: 0;
             display: flex;
             flex-direction: column;
             gap: var(--space-s);
          }
          .stat-progress-item {
            display: flex;
            flex-direction: column;
            gap: var(--space-3xs);
          }
          .stat-progress {
            display: flex;
            justify-content: space-between;
            font-size: var(--text--1);
            font-weight: 600;
            color: var(--color-primary-navy);
          }
          .stat-progress-bar {
            height: 8px;
            background: #edf2f7;
            border-radius: 4px;
            overflow: hidden;
            width: 100%;
          }
          .stat-progress-bar__fill {
            height: 100%;
            background: var(--color-turquoise);
            border-radius: 4px;
            transition: width 0.5s ease-out;
          }
          .stat-progress-meta {
            font-size: var(--text--2);
            color: var(--color-neutral-grey);
            text-align: right;
          }

          /* Area List Styling */
          .stat-list {
            list-style: none;
            padding: 0;
            margin: 0;
            display: flex;
            flex-direction: column;
            gap: var(--space-xs);
          }
          .stat-list-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: var(--space-xs);
            background: #f8fafc;
            border-radius: 8px;
            font-size: var(--text--1);
            color: var(--color-primary-navy);
          }
          .stat-list-label {
            display: flex;
            align-items: center;
            gap: var(--space-xs);
            font-weight: 500;
          }

          /* Form Elements Overrides */
          select.input {
            appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%230a165e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right var(--space-xs) center;
            background-size: 16px;
            padding-right: var(--space-l);
          }

        </style>
      </head>
      <body>
        <header class="header">
          <div class="center center--gutter">
            <div class="header__stack">
              <a href="/admin" style="font-weight: bold; font-size: var(--text-1); text-decoration: none; color: var(--color-primary-navy);">
                Toilet Map Admin
              </a>
              <nav>
                <ul class="header__nav">
                  <li><a href="/admin">Loos</a></li>
                  <li><a href="/admin/users/admin">User admin</a></li>
                  <li><a href="/admin/users/statistics">User stats</a></li>
                  <li><a href="/admin/logout">Logout</a></li>
                </ul>
              </nav>
            </div>
          </div>
        </header>
        <main class="center center--gutter" style="padding-top: var(--space-l);">
          ${props.children}
        </main>
        <script>
          (function () {
            if (typeof window === 'undefined') {
              return;
            }

            const searchForms = window.document.querySelectorAll('[data-autosubmit="search"]');
            searchForms.forEach((form) => {
              const searchInput = form.querySelector('input[name="search"]');
              if (!searchInput) return;
              let timerId;
              searchInput.addEventListener('input', () => {
                window.clearTimeout(timerId);
                timerId = window.setTimeout(() => {
                  if (searchInput.value.trim().length === 0 && !form.dataset.allowEmpty) {
                    return;
                  }
                  form.requestSubmit();
                }, 350);
              });

              const clearBtn = form.querySelector('[data-clear-search]');
              if (clearBtn) {
                clearBtn.addEventListener('click', (event) => {
                  event.preventDefault();
                  searchInput.value = '';
                  const pageInput = form.querySelector('input[name="page"]');
                  if (pageInput) {
                    pageInput.setAttribute('value', '1');
                  }
                  form.requestSubmit();
                });
              }
            });

            const collapsiblePanels = window.document.querySelectorAll('[data-collapsible]');
            collapsiblePanels.forEach((panel) => {
              const toggle = panel.querySelector('[data-collapsible-toggle]');
              if (!toggle) return;
              const label = toggle.querySelector('[data-collapsible-label]');
              const showLabel = toggle.getAttribute('data-collapsible-show-label') || 'Show';
              const hideLabel = toggle.getAttribute('data-collapsible-hide-label') || 'Hide';
              let isOpen = !panel.classList.contains('collapsible--collapsed');

              const update = () => {
                panel.classList.toggle('collapsible--collapsed', !isOpen);
                if (label) {
                  label.textContent = isOpen ? hideLabel : showLabel;
                }
              };

              update();

              toggle.addEventListener('click', () => {
                isOpen = !isOpen;
                update();
              });
            });
          })();
        </script>
      </body>
    </html>
  `;
};
