// AIHelper.gs – AI-powered invoice/receipt parsing with OCR + optional Gemini
//
// Setup:
//   1. Optional: get a Gemini API key from https://aistudio.google.com/app/apikey
//   2. Optional: get an OCR.Space API key from https://ocr.space/ocrapi
//   3. In GAS editor: Project Settings → Script Properties
//   4. Add properties: GEMINI_API_KEY = <your key>, OCR_SPACE_API_KEY = <your key>
//   5. Redeploy the web app

var AI_FILL_UNAVAILABLE_MESSAGE = 'Auto-fill is temporarily unavailable. Please enter details manually.';
var AI_FILL_PARTIAL_SUCCESS_MESSAGE = 'Basic details were extracted. Please verify before saving.';

function billingMonthFromIso_(isoDate) {
  var m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  var monthIdx = parseInt(m[2], 10) - 1;
  if (monthIdx < 0 || monthIdx > 11) return '';
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[monthIdx] + '-' + m[1];
}

function invoiceParserConfidence_(data, debug) {
  var score = 0;
  if (data && data.Date) score += 3;
  if (data && data.Amount && Number(data.Amount) > 0) score += 3;
  if (data && data.VendorOrPerson) score += /(\s|pvt\.?\s*ltd\.?|private\s*limited|llp|limited|inc\.|hotel|airways|airlines|travels|taxi|store)/i.test(data.VendorOrPerson) ? 3 : 1;
  if (data && data.BillNo) score += 1;
  if (data && data.VendorGSTIN) score += 1;
  var q = debug && debug.textQuality ? debug.textQuality : {};
  if (q.alphaRatio !== undefined && q.alphaRatio < 0.18) score -= 2;
  if (q.noisyRatio !== undefined && q.noisyRatio > 0.18) score -= 2;
  return {
    score: score,
    strong: score >= 5,
    usable: score >= 3 || !!(data && data.Amount && data.VendorOrPerson)
  };
}

function parseInvoiceWithAI(payload) {
  payload = payload || {};
  var base64   = payload.base64;
  var mimeType = payload.mimeType || 'image/jpeg';

  if (!base64) {
    return {
      ok: false,
      errorType: 'missing_image',
      message: AI_FILL_UNAVAILABLE_MESSAGE,
      _debug: { reason: 'No image data received.' }
    };
  }

  var debug = { stages: [] };

  // A. OCR text extraction: Drive first for sub-2 MB invoices, OCR.Space second.
  var extracted = extractInvoiceText(payload);
  if (extracted.ok) {
    debug.stages.push({ stage: 'ocr', source: extracted.source, status: extracted.status || 'used', textLength: extracted.text ? extracted.text.length : 0 });

    // B. Parser from plain OCR text.
    var parsed = parseInvoiceText(extracted.text);
    if (parsed.ok) {
      parsed.source = extracted.source;
      parsed.message = AI_FILL_PARTIAL_SUCCESS_MESSAGE;
      if (!parsed._debug) parsed._debug = {};
      parsed._debug.flow = debug;
      parsed._debug.ocrSource = extracted.source;
      parsed._debug.ocrStatus = extracted.status || 'used';
      parsed._debug.ocrTextLength = extracted.text ? extracted.text.length : 0;

      // C. Optional AI enhancement. Ignore failures so autofill remains continuous.
      var enhanced = enhanceInvoiceWithGemini(payload, extracted.text, parsed);
      if (enhanced.ok) {
        enhanced.message = AI_FILL_PARTIAL_SUCCESS_MESSAGE;
        if (!enhanced._debug) enhanced._debug = {};
        enhanced._debug.flow = debug;
        enhanced._debug.ocrSource = extracted.source;
        enhanced._debug.ocrStatus = extracted.status || 'used';
        enhanced._debug.ocrTextLength = extracted.text ? extracted.text.length : 0;
        return enhanced;
      }
      logProviderFailure('Gemini enhancement skipped', enhanced);
      return parsed;
    }

    debug.stages.push({ stage: 'parse', source: extracted.source, status: 'failed', parserDebug: parsed._debug || null });

    var enhanced = enhanceInvoiceWithGemini(payload, extracted.text, parsed);
    if (enhanced.ok) {
      enhanced.message = AI_FILL_PARTIAL_SUCCESS_MESSAGE;
      if (!enhanced._debug) enhanced._debug = {};
      enhanced._debug.flow = debug;
      enhanced._debug.ocrSource = extracted.source;
      enhanced._debug.ocrStatus = extracted.status || 'used';
      enhanced._debug.ocrTextLength = extracted.text ? extracted.text.length : 0;
      return enhanced;
    }
    logProviderFailure('Gemini parse fallback skipped', enhanced);
  } else {
    debug.stages.push({ stage: 'ocr', status: 'failed', source: extracted.source || 'none', errorType: extracted.errorType || 'ocr_failed' });
    logProviderFailure('OCR extraction failed', extracted);
  }

  // Last non-provider attempt for text-based PDFs.
  var fallbackText = extractReadableText(base64, mimeType);
  var fallbackParsed = parseInvoiceText(fallbackText);
  if (fallbackParsed.ok) {
    fallbackParsed.source = 'raw_pdf_text';
    fallbackParsed.message = AI_FILL_PARTIAL_SUCCESS_MESSAGE;
    if (!fallbackParsed._debug) fallbackParsed._debug = {};
    fallbackParsed._debug.flow = debug;
    fallbackParsed._debug.rawTextLength = fallbackText ? fallbackText.length : 0;
    return fallbackParsed;
  }
  debug.stages.push({ stage: 'raw_pdf_text', status: 'failed', parserDebug: fallbackParsed._debug || null });

  return {
    ok: false,
    errorType: 'auto_fill_unavailable',
    message: AI_FILL_UNAVAILABLE_MESSAGE,
    _debug: debug
  };
}

// A. OCR text extraction. Primary: Drive OCR. Secondary: OCR.Space.
function extractInvoiceText(payload) {
  payload = payload || {};
  var base64   = payload.base64;
  var mimeType = payload.mimeType || 'application/pdf';

  var driveOcr = extractTextViaDriveOCR(base64, mimeType);
  var text = driveOcr && driveOcr.text ? driveOcr.text : '';
  if (text && text.trim().length >= 20) {
    return { ok: true, source: 'drive_ocr', text: text, status: driveOcr.status || 'used' };
  }
  logProviderFailure('Drive OCR returned no usable text', driveOcr);

  var ocrSpace = extractTextViaOcrSpace(base64, mimeType);
  var ocrSpaceText = ocrSpace && ocrSpace.text ? ocrSpace.text : '';
  if (ocrSpaceText && ocrSpaceText.trim().length >= 20) {
    return { ok: true, source: 'ocr_space', text: ocrSpaceText, status: ocrSpace.status || 'used' };
  }
  logProviderFailure('OCR.Space returned no usable text', ocrSpace);

  var error = (driveOcr && driveOcr.error ? String(driveOcr.error) : '') ||
              (ocrSpace && ocrSpace.error ? String(ocrSpace.error) : '');
  var result = {
    ok: false,
    errorType: 'ocr_failed',
    source: 'drive_ocr,ocr_space',
    status: 'empty',
    message: AI_FILL_UNAVAILABLE_MESSAGE,
    _debug: {
      drive: sanitizeProviderResult(driveOcr),
      ocrSpace: sanitizeProviderResult(ocrSpace),
      error: error || 'OCR did not return readable text.',
      providerOrder: ['drive_ocr', 'ocr_space']
    }
  };
  if (/rate limit|quota|resource_exhausted|user rate limit exceeded/i.test(error)) {
    result.errorType = 'quota';
  } else if (/permissions are not sufficient|auth\/documents|authorization|permission/i.test(error)) {
    result.errorType = 'ocr_permission';
  } else if (/service error.*drive|drive.*service error/i.test(error)) {
    result.errorType = 'ocr_permission';
  }
  return result;
}

// B. Parser from plain extracted text.
function parseInvoiceText(text) {
  return fallbackExtractExpenseFromText(text);
}

// C. Optional AI enhancement. Gemini is not mandatory for extraction.
function enhanceInvoiceWithGemini(payload, extractedText, parserResult) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) return { ok: false, errorType: 'ai_unavailable', message: AI_FILL_UNAVAILABLE_MESSAGE, _debug: { reason: 'Gemini API key is not configured.' } };

  payload = payload || {};
  var base64   = payload.base64;
  var mimeType = payload.mimeType || 'image/jpeg';
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=' + apiKey;

  var prompt =
    'You are an expense-form assistant for an Indian company. Extract data from this invoice/receipt image or PDF ' +
    'and return ONLY a valid JSON object with exactly these keys (use empty string "" for any field not found):\n' +
    '{\n' +
    '  "Date": "invoice/receipt date in YYYY-MM-DD format",\n' +
    '  "VendorOrPerson": "seller / merchant / vendor name",\n' +
    '  "Description": "short 1-line service description — include service context where visible, e.g. Airport Taxi - Radio Taxi Services, Air Ticket Cancellation, Hotel Stay",\n' +
    '  "TaxableValue": "pre-GST / taxable / net fare amount as plain number, or empty string",\n' +
    '  "CGSTAmount": "CGST amount as plain number, or empty string — leave empty if IGST applies",\n' +
    '  "SGSTAmount": "SGST amount as plain number, or empty string — leave empty if IGST applies",\n' +
    '  "IGSTAmount": "IGST amount as plain number, or empty string — fill when seller and buyer are in different states",\n' +
    '  "GSTAmount": "total GST amount (CGST+SGST or IGST) as plain number — do NOT include toll or reimbursements",\n' +
    '  "Amount": "grand total / Total Fare / Invoice Total — the final payable amount at bottom of invoice",\n' +
    '  "BillNo": "invoice number / receipt number / bill number if visible",\n' +
    '  "VendorGSTIN": "seller GSTIN if visible, or empty string",\n' +
    '  "PaymentMode": "one of: Cash, Card, UPI, NEFT, IMPS, Cheque — or empty string if unknown",\n' +
    '  "ExpenseType": "one of: Travel, Accommodation, Food, Office, Vendor, Misc — guess from context",\n' +
    '  "Category": "short label e.g. Taxi, Airport Transfer, Air Travel, Hotel Stay, Lunch, Stationery, Consulting, Misc"\n' +
    '}\n' +
    'ExpenseType guessing rules:\n' +
    '- taxi/cab/uber/ola/rapido/auto -> Travel\n' +
    '- hotel/lodge/stay/oyo/airbnb -> Accommodation\n' +
    '- restaurant/cafe/swiggy/zomato/food/dining -> Food\n' +
    '- stationery/office supplies/ink/paper/printer -> Office\n' +
    '- consultant/freelancer/professional services/vendor invoice -> Vendor\n' +
    '- ticket cancellation/flight/airline/boarding/travel agency/tour and travels/IATA -> Travel\n' +
    '- otherwise -> Misc\n' +
    'Category overrides (use these exact strings where applicable):\n' +
    '- flight/airline/ticket/cancellation/PNR/airways/air travel -> Category: "Air Travel"\n' +
    '- taxi/cab/uber/ola/rapido/auto-rickshaw -> Category: "Taxi"\n' +
    'Rules:\n' +
    '- Return ONLY the JSON object — no markdown fences, no explanation, no extra text.\n' +
    '- All numeric fields must be plain numbers (no ₹ symbol, no commas, no spaces).\n' +
    '- Date must be YYYY-MM-DD. If only month/year is visible, use the 1st of that month.\n' +
    '- 2-digit years: "19-Apr-26" or "14-Apr-26" means 2026. Always expand to 20XX.\n' +
    '- Amount: use the single grand total at the bottom of the invoice (the final payable amount), not a sub-total or line item.\n' +
    '- If OCR text is provided below, prefer it over PDF metadata and compressed-object text.\n' +
    '- If the invoice is in Hindi/regional language, still extract the numbers and names correctly.\n' +
    '- GST detection: if seller state ≠ buyer state (interstate), the tax is IGST — put the total in IGSTAmount, leave CGSTAmount and SGSTAmount empty. If seller and buyer are in the same state (intrastate), split equally into CGSTAmount and SGSTAmount, leave IGSTAmount empty.\n\n' +
    'OCR text, if available:\n' + (extractedText ? String(extractedText).slice(0, 12000) : '');

  var requestBody = {
    contents: [{
      parts: base64 ? [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: base64 } }
      ] : [
        { text: prompt }
      ]
    }],
    generationConfig: { temperature: 0, maxOutputTokens: 600 }
  };

  try {
    var lastQuotaMessage = '';
    for (var attempt = 0; attempt < 2; attempt++) {
      var response = UrlFetchApp.fetch(url, {
        method:      'post',
        contentType: 'application/json',
        payload:     JSON.stringify(requestBody),
        muteHttpExceptions: true
      });

      var statusCode = response.getResponseCode();
      var raw = response.getContentText();
      var result = JSON.parse(raw);

      // Detect quota / rate-limit. Caller will use parser/manual fallback.
      var isQuota = statusCode === 429 ||
                    (result.error && (
                      result.error.code === 429 ||
                      result.error.status === 'RESOURCE_EXHAUSTED' ||
                      (result.error.message && result.error.message.toLowerCase().indexOf('quota') !== -1) ||
                      (result.error.message && result.error.message.toLowerCase().indexOf('rate') !== -1)
                    ));
      if (isQuota) {
        lastQuotaMessage = result.error && result.error.message ? result.error.message : 'Gemini quota/rate limit reached.';
        Logger.log('[AI Fill Gemini quota attempt ' + (attempt + 1) + '] ' + lastQuotaMessage);
        if (attempt < 1) {
          Utilities.sleep(800);
          continue;
        }
        return {
          ok: false,
          errorType: 'quota',
          message: AI_FILL_UNAVAILABLE_MESSAGE,
          _debug: { provider: 'gemini', error: lastQuotaMessage }
        };
      }

      if (result.error) {
        Logger.log('[AI Fill Gemini error] ' + (result.error.message || raw));
        return {
          ok: false,
          errorType: 'ai_failed',
          message: AI_FILL_UNAVAILABLE_MESSAGE,
          _debug: { provider: 'gemini', error: result.error.message || raw }
        };
      }

      var text = result.candidates[0].content.parts[0].text.trim();

      // Strip markdown code fences if Gemini wraps in them
      text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();

      var data = JSON.parse(text);
      return { ok: true, source: 'gemini', data: data };
    }

    return { ok: false, errorType: 'quota', message: AI_FILL_UNAVAILABLE_MESSAGE, _debug: { provider: 'gemini', error: lastQuotaMessage } };
  } catch (e) {
    var msg = e && e.message ? e.message : String(e);
    Logger.log('[AI Fill Gemini exception] ' + msg);
    return { ok: false, errorType: 'ai_failed', message: AI_FILL_UNAVAILABLE_MESSAGE, _debug: { provider: 'gemini', error: msg } };
  }
}

// Try quick text extraction first; if weak, run Drive OCR and retry parsing.
function parseWithFallbackAndOCR(base64, mimeType) {
  function isQuotaLike(msg) {
    var s = String(msg || '').toLowerCase();
    return s.indexOf('rate limit') !== -1 ||
           s.indexOf('quota') !== -1 ||
           s.indexOf('resource_exhausted') !== -1 ||
           s.indexOf('user rate limit exceeded') !== -1;
  }

  var extractedText = extractReadableText(base64, mimeType);
  var quick = fallbackExtractExpenseFromText(extractedText);
  if (quick.ok) return quick;

  var weak = !quick._debug || !quick._debug.textQuality ||
             quick._debug.textQuality.noisyRatio > 0.12 ||
             quick._debug.textQuality.alphaRatio < 0.22 ||
             (quick._debug.amountCandidates && quick._debug.amountCandidates.length === 0);
  if (!weak) return quick;

  var ocr = extractInvoiceText({ base64: base64, mimeType: mimeType });
  var ocrText = ocr && ocr.text ? ocr.text : '';
  if (!ocrText || ocrText.trim().length < 20) {
    if (!quick._debug) quick._debug = {};
    quick._debug.ocrAttempted = true;
    quick._debug.ocrSource = ocr && ocr.source ? ocr.source : '';
    quick._debug.ocrStatus = ocr && ocr.status ? ocr.status : 'empty';
    if (ocr && ocr._debug) quick._debug.ocrError = ocr._debug;

    if (ocr && ocr.error && isQuotaLike(ocr.error)) {
      return {
        ok: false,
        errorType: 'quota',
        _debug: quick._debug,
        message: AI_FILL_UNAVAILABLE_MESSAGE
      };
    }
    if (ocr && ocr.error && /permissions are not sufficient|auth\/documents|authorization|permission/i.test(ocr.error)) {
      return {
        ok: false,
        errorType: 'ocr_permission',
        _debug: quick._debug,
        message: AI_FILL_UNAVAILABLE_MESSAGE
      };
    }
    return quick;
  }

  var ocrResult = fallbackExtractExpenseFromText(ocrText);
  if (ocrResult._debug) {
    ocrResult._debug.ocrAttempted = true;
    ocrResult._debug.ocrStatus = ocr && ocr.status ? ocr.status : 'used';
  }
  return ocrResult;
}

// OCR via Drive conversion to Google Doc. Requires Advanced Drive service.
function extractTextViaDriveOCR(base64, mimeType) {
  function isRetryableOcrError(msg) {
    return /rate limit|quota|resource_exhausted|user rate limit exceeded|service invoked too many times|try again|service error/i.test(String(msg || ''));
  }
  function classifyDriveOcrError(msg) {
    if (/Drive is not defined|Cannot read propert(?:y|ies).*Files|Advanced Drive/i.test(String(msg || ''))) return 'advanced_drive_unavailable';
    if (/permissions are not sufficient|auth\/documents|authorization|permission|access denied/i.test(String(msg || ''))) return 'ocr_permission';
    if (/rate limit|quota|resource_exhausted|user rate limit exceeded|service invoked too many times/i.test(String(msg || ''))) return 'quota';
    return 'drive_ocr_error';
  }

  try {
    if (typeof Drive === 'undefined' || !Drive.Files || !Drive.Files.insert) {
      var missingDrive = 'Advanced Drive service is not enabled.';
      Logger.log('[AI Fill Drive OCR unavailable] ' + missingDrive);
      return { text: '', status: 'unavailable', errorType: 'advanced_drive_unavailable', error: missingDrive };
    }
    if (typeof DocumentApp === 'undefined') {
      var missingDocs = 'DocumentApp service is unavailable for OCR readback.';
      Logger.log('[AI Fill Drive OCR unavailable] ' + missingDocs);
      return { text: '', status: 'unavailable', errorType: 'ocr_permission', error: missingDocs };
    }

    var bytes = Utilities.base64Decode(base64);
    var ext = (mimeType && mimeType.indexOf('pdf') !== -1) ? '.pdf' : '.jpg';
    var blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', 'ai_invoice_' + Date.now() + ext);

    var lastError = '';
    for (var attempt = 0; attempt < 3; attempt++) {
      var docId = null;
      try {
        // Upload original blob and let Drive convert+OCR it to a Google Doc.
        var ocrDoc = Drive.Files.insert(
          { title: 'ai_ocr_' + Date.now() + '_' + attempt },
          blob,
          { convert: true, ocr: true, ocrLanguage: 'en' }
        );
        docId = ocrDoc.id;

        var text = DocumentApp.openById(docId).getBody().getText() || '';
        return { text: text, status: text.trim().length ? 'used' : 'empty' };
      } catch (inner) {
        lastError = (inner && inner.message ? inner.message : String(inner));
        Logger.log('[AI Fill Drive OCR error attempt ' + (attempt + 1) + '] ' + classifyDriveOcrError(lastError) + ': ' + lastError);
        if (!isRetryableOcrError(lastError) || attempt === 2) {
          return { text: '', status: 'error', errorType: classifyDriveOcrError(lastError), error: lastError };
        }
        Utilities.sleep((attempt + 1) * 1500);
      } finally {
        try { if (docId) DriveApp.getFileById(docId).setTrashed(true); } catch (cleanupErr) {}
      }
    }

    return { text: '', status: 'error', errorType: classifyDriveOcrError(lastError), error: lastError || 'OCR did not return readable text.' };
  } catch (e) {
    var msg = (e && e.message ? e.message : String(e));
    Logger.log('[AI Fill Drive OCR exception] ' + classifyDriveOcrError(msg) + ': ' + msg);
    return { text: '', status: 'error', errorType: classifyDriveOcrError(msg), error: msg };
  }
}

// Secondary OCR provider. Configure OCR_SPACE_API_KEY for normal use.
// If missing, the public demo key is tried only as a best-effort fallback.
function extractTextViaOcrSpace(base64, mimeType) {
  try {
    var configuredKey = PropertiesService.getScriptProperties().getProperty('OCR_SPACE_API_KEY');
    var apiKey = configuredKey || 'helloworld';
    if (!configuredKey) Logger.log('[AI Fill OCR.Space config] OCR_SPACE_API_KEY is missing; using public demo key with low reliability.');
    var dataUrl = 'data:' + (mimeType || 'application/octet-stream') + ';base64,' + base64;
    var response = UrlFetchApp.fetch('https://api.ocr.space/parse/image', {
      method: 'post',
      payload: {
        apikey: apiKey,
        base64Image: dataUrl,
        language: 'eng',
        isOverlayRequired: 'false',
        scale: 'true',
        OCREngine: '2'
      },
      muteHttpExceptions: true
    });

    var statusCode = response.getResponseCode();
    var raw = response.getContentText();
    var result = JSON.parse(raw);
    if (statusCode >= 400 || result.IsErroredOnProcessing) {
      var err = '';
      if (result.ErrorMessage) {
        err = Object.prototype.toString.call(result.ErrorMessage) === '[object Array]'
          ? result.ErrorMessage.join(' | ')
          : String(result.ErrorMessage);
      }
      if (!err && result.ErrorDetails) err = String(result.ErrorDetails);
      if (!err) err = raw;
      Logger.log('[AI Fill OCR.Space error] ' + err);
      return { text: '', status: 'error', errorType: configuredKey ? 'ocr_space_error' : 'ocr_space_demo_key_error', error: err };
    }

    var parsed = result.ParsedResults || [];
    var textParts = [];
    for (var i = 0; i < parsed.length; i++) {
      if (parsed[i] && parsed[i].ParsedText) textParts.push(parsed[i].ParsedText);
    }
    var text = textParts.join('\n').trim();
    return { text: text, status: text ? (configuredKey ? 'used' : 'used_demo_key') : 'empty' };
  } catch (e) {
    var msg = e && e.message ? e.message : String(e);
    Logger.log('[AI Fill OCR.Space exception] ' + msg);
    return { text: '', status: 'error', errorType: 'ocr_space_exception', error: msg };
  }
}

function logProviderFailure(label, result) {
  try {
    if (!result) {
      Logger.log('[AI Fill provider] ' + label + ': no result');
      return;
    }
    var raw = result.error || result.message || result.status || JSON.stringify(result).slice(0, 500);
    Logger.log('[AI Fill provider] ' + label + ': ' + raw);
  } catch (e) {}
}

function sanitizeProviderResult(result) {
  if (!result) return null;
  return {
    status: result.status || '',
    errorType: result.errorType || '',
    error: result.error || '',
    textLength: result.text ? result.text.length : 0
  };
}

// ---------------------------------------------------------------------------
// extractReadableText – pulls printable text from a base64 payload.
// Works well for text/plain and text-based PDFs; returns empty for images.
// ---------------------------------------------------------------------------
function extractReadableText(base64, mimeType) {
  try {
    var bytes = Utilities.base64Decode(base64);

    // Plain-text file: decode directly
    if (mimeType && mimeType.indexOf('text/') === 0) {
      return Utilities.newBlob(bytes).getDataAsString('UTF-8');
    }

    // PDF: scan first 60 KB for readable ASCII runs, then extract PDF string literals
    var limit = Math.min(bytes.length, 61440);
    var ascii = '';
    for (var i = 0; i < limit; i++) {
      var b = bytes[i];
      ascii += (b >= 32 && b < 127) || b === 9 || b === 10 || b === 13
               ? String.fromCharCode(b) : ' ';
    }

    // Extract PDF string literals: content inside ( ... ) parentheses
    var texts = [];
    var paren = ascii.match(/\(([^)]{2,100})\)/g);
    if (paren) {
      paren.forEach(function(p) {
        var inner = p.slice(1, -1).trim();
        if (/[a-zA-Z0-9]{2,}/.test(inner)) texts.push(inner);
      });
    }
    // Also grab lines of bare ASCII that look like real text
    ascii.split(/\n/).forEach(function(line) {
      line = line.trim();
      if (line.length > 4 && /[a-zA-Z]{3,}/.test(line)) texts.push(line);
    });
    return texts.join('\n');
  } catch (e) {
    return '';
  }
}

// ---------------------------------------------------------------------------
// fallbackExtractExpenseFromText – regex-based extractor used when Gemini
// is unavailable (quota / rate-limit). Returns partial data where possible.
// ---------------------------------------------------------------------------
function fallbackExtractExpenseFromText(text) {
  if (!text || text.trim().length < 10) {
    return { ok: false, errorType: 'fallback_failed',
             _debug: { reason: 'empty_or_too_short_text' },
             hint: 'Try a clearer image/PDF with visible date, vendor, and total amount.',
             message: 'Could not extract enough details. Please enter manually.' };
  }

  // ---- Pre-process: fix common OCR/PDF-extraction artefacts ----
  var cleaned = text
    .replace(/\bD:\d{14}(?:[-+Z']?\d*)*/g, ' ')   // PDF metadata timestamps, not invoice dates
    .replace(/([a-z])([A-Z])/g, '$1 $2')          // camelCase  → spaced words
    .replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2') // ACRONYMWord → ACRONYM Word
    .replace(/(\d{4})(\d{2}:\d{2})/g, '$1 $2')    // "202609:56" → "2026 09:56"
    .replace(/[ \t]{2,}/g, ' ')                    // collapse horizontal whitespace
    .trim();

  var lines = cleaned.split(/\r?\n/).map(function(l) { return l.trim(); }).filter(Boolean);
  var alphaCount = (cleaned.match(/[A-Za-z]/g) || []).length;
  var digitCount = (cleaned.match(/\d/g) || []).length;
  var noisyCharCount = (cleaned.match(/[^A-Za-z0-9\s.,:;()\/%&+\-]/g) || []).length;
  var textQuality = {
    alphaRatio: cleaned ? alphaCount / cleaned.length : 0,
    digitRatio: cleaned ? digitCount / cleaned.length : 0,
    noisyRatio: cleaned ? noisyCharCount / cleaned.length : 0,
    lineCount: lines.length
  };

  var data      = {};
  var notes     = [];
  var lo        = cleaned.toLowerCase();
  var debug     = {
    vendorCandidates: [],
    chosenVendor:     '',
    amountCandidates: [],
    chosenAmount:     '',
    dateCandidates:   [],
    chosenDate:       '',
    taxableCandidate: '',
    gstCandidate:     '',
    notesExtracted:   '',
    textQuality:      textQuality,
    rawPreview:       cleaned.substring(0, 400)
  };
  function parseMoney(raw) {
    var n = parseFloat(String(raw || '').replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  }
  function moneyValues(str) {
    var values = [];
    var re = /(?:₹|rs\.?|inr)?\s*((?:\d{1,3}(?:,\d{2,3})+|\d{1,})(?:\.\d{1,2})?)/gi;
    var mm;
    while ((mm = re.exec(String(str || ''))) !== null) {
      values.push(parseMoney(mm[1]));
    }
    return values.filter(function(v) { return v > 0; });
  }
  function currencyMoneyValues(str) {
    var values = [];
    var re = /(?:₹|rs\.?|inr)\s*((?:\d{1,3}(?:,\d{2,3})+|\d{1,})(?:\.\d{1,2})?)/gi;
    var mm;
    while ((mm = re.exec(String(str || ''))) !== null) {
      values.push(parseMoney(mm[1]));
    }
    return values.filter(function(v) { return v > 0; });
  }
  function chooseMoneyNearLabel(labels, span) {
    var best = null;
    for (var i = 0; i < labels.length; i++) {
      var re = new RegExp(labels[i] + '[\\s\\S]{0,' + (span || 160) + '}', 'i');
      var m = cleaned.match(re);
      if (!m) continue;
      var snippet = m[0].replace(/\b(?:invoice|bill|receipt|booking|order|auth|transaction|terminal|merchant|serial|part)\s*(?:no\\.?|number|id|ref)?\\s*:?\\s*[A-Z0-9\\/-]{4,}/gi, ' ');
      snippet = snippet.replace(/\d+(?:\.\d+)?\s*%/g, ' ');
      var vals = currencyMoneyValues(snippet);
      if (!vals.length) vals = moneyValues(snippet);
      vals = vals.filter(function(v) { return v >= 1 && v < 100000000; });
      if (vals.length) {
        // Use the FIRST value: it is the field value immediately after the label.
        // The last value is often a trailing column from a GST/tax breakdown table.
        best = { label: labels[i], value: vals[0], snippet: snippet.substring(0, 140) };
        break;
      }
    }
    return best;
  }

  // ---- A. Date ----
  var MON = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
              jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  function validDateParts(y, mo, d) {
    y = +y; mo = +mo; d = +d;
    if (y < 2000 || y > 2035 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
    var maxDays = [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return d <= maxDays[mo - 1];
  }
  function isoFromParts(y, mo, d) {
    y = +y; mo = +mo; d = +d;
    return validDateParts(y, mo, d) ? y + '-' + pad2(mo) + '-' + pad2(d) : '';
  }
  var datePats = [
    // dd-Mon-yy  e.g. 16-Apr-26
    { re: /\b(\d{1,2})[\/\-.](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\/\-.](\d{2})(?!\d)/i,
      fn: function(m) { return isoFromParts(2000+parseInt(m[3],10), MON[m[2].slice(0,3).toLowerCase()], m[1]); } },
    // dd Mon yy  e.g. 16 Apr 26
    { re: /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,]+(\d{2})(?!\d)/i,
      fn: function(m) { return isoFromParts(2000+parseInt(m[3],10), MON[m[2].slice(0,3).toLowerCase()], m[1]); } },
    // dd-mm-yyyy / dd.mm.yyyy  e.g. 16-04-2026 or 16.04.2026
    { re: /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?!\d)/,
      fn: function(m) {
        var d=+m[1], mo=+m[2], y=+m[3];
        if (mo>12){var t=d;d=mo;mo=t;}
        return isoFromParts(y, mo, d);
      } },
    // dd-mm-yy / dd.mm.yy  e.g. 27/04/26. Prefer Indian dd-mm-yy order.
    { re: /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})(?!\d)/,
      fn: function(m) {
        var d=+m[1], mo=+m[2], y=2000+parseInt(m[3],10);
        if (mo>12){var t=d;d=mo;mo=t;}
        return isoFromParts(y, mo, d);
      } },
    // yyyy-mm-dd
    { re: /\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/,
      fn: function(m) { return isoFromParts(m[1], m[2], m[3]); } },
    // dd Mon yyyy  e.g. 16 April 2026
    { re: /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,]+(\d{4})\b/i,
      fn: function(m) { return isoFromParts(m[3], MON[m[2].slice(0,3).toLowerCase()], m[1]); } },
    // Mon dd, yyyy  e.g. "April 28, 2026" or "Apr 28, 2026" (Uber/US format)
    { re: /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,]+(\d{1,2})[\s,]+(\d{4})\b/i,
      fn: function(m) { return isoFromParts(m[3], MON[m[1].slice(0,3).toLowerCase()], m[2]); } },
    // Weekday, dd Mon yyyy  e.g. "Mon, 28 April 2026" / "Monday, 28 April 2026" (Uber trip receipts)
    { re: /(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,]+(\d{4})\b/i,
      fn: function(m) { return isoFromParts(m[3], MON[m[2].slice(0,3).toLowerCase()], m[1]); } },
    // compact ddmmyyyy near labels, e.g. Date: 27042026
    { re: /\b(\d{2})(\d{2})(20\d{2})\b/,
      fn: function(m) { return isoFromParts(m[3], m[2], m[1]); } }
  ];
  // Prefer "Dated" label specifically — it is the invoice date field on most Indian invoices.
  // Checked first to avoid false matches on "Reference No. & Date." which also contains "Date".
  var _datedCtx = cleaned.match(/\bDated\s*:?\s*([^\n]{1,80})/i);
  var dateCtx = _datedCtx ||
    cleaned.match(/(?:invoice\s*(?:date|dt\.?)|inv\s*(?:date|dt\.?)|bill\s*(?:date|dt\.?)|receipt\s*(?:date|dt\.?)|trip\s*(?:on|date)|date\s*(?:[&:]\s*time)?)\s*:?\s*([^\n]{0,80})/i);
  var dateSearch = dateCtx ? dateCtx[0] : cleaned;
  for (var pi=0; pi<datePats.length; pi++) {
    var m = dateSearch.match(datePats[pi].re) || cleaned.match(datePats[pi].re);
    if (m) {
      try {
        var dc = datePats[pi].fn(m);
        if (dc) {
          debug.dateCandidates.push(dc);
          data.Date = dc;
          break;
        }
      } catch(ex) {}
    }
  }
  debug.chosenDate = data.Date || '';

  // ---- B. Amount (priority-ordered; "Total Fare" first for cab invoices) ----
  var amountPick = chooseMoneyNearLabel([
    'grand\\s*total',
    'amount\\s*payable',
    'total\\s*(?:price|amount|fare|payable|due|invoice\\s*value)',
    'invoice\\s*total',
    'net\\s*payable',
    '\\btotal\\b\\s*[ī₹]',   // "Total ₹ X" or "Total ī X" — ī is garbled ₹ in raw Tally PDFs
    '\\btotal\\b'
  ], 180);
  if (amountPick) {
    // Scan ALL "Total" lines for the maximum value.
    // Raw PDF byte order can put the GST breakdown "Total 100.00" before the main
    // invoice "Total ₹ 6,569.00", so a first-match pick may grab a sub-total.
    // The invoice grand total is always the largest of any "Total" line.
    var _totalRe = /\btotal\b[^\n]{0,80}/gi;
    var _tm, _allTotals = [];
    while ((_tm = _totalRe.exec(cleaned)) !== null) {
      var _ts = _tm[0].replace(/\d+(?:\.\d+)?\s*%/g, ' ');
      var _tv = currencyMoneyValues(_ts); if (!_tv.length) _tv = moneyValues(_ts);
      _tv.forEach(function(v) { if (v >= 1 && v < 10000000) _allTotals.push(v); });
    }
    var _maxTotal = _allTotals.length ? Math.max.apply(null, _allTotals) : 0;
    if (_maxTotal > amountPick.value) {
      debug.amountCandidates.push({ label: 'total-max', value: _maxTotal, source: 'max-across-totals' });
      amountPick.value = _maxTotal;
    }
    data.Amount = amountPick.value;
    debug.amountCandidates.push({ label: amountPick.label, value: amountPick.value, source: 'label-window', snippet: amountPick.snippet });
  }
  if (!data.Amount) {
    for (var ali = 0; ali < lines.length; ali++) {
      var line = lines[ali];
      if (!/(total\s*fare|grand\s*total|invoice\s*total|total\s*amount|\btotal\b|amount\s*payable|amount\s*due|net\s*amount)/i.test(line)) continue;
      var neighborhood = [line, lines[ali + 1] || '', lines[ali + 2] || ''].join(' ');
      neighborhood = neighborhood.replace(/\d+(?:\.\d+)?\s*%/g, ' ');
      var lineVals = currencyMoneyValues(neighborhood);
      if (!lineVals.length) lineVals = moneyValues(neighborhood);
      debug.amountCandidates.push({
        label: 'line-scan',
        snippet: neighborhood.substring(0, 120),
        value: lineVals.length ? lineVals[lineVals.length - 1] : ''
      });
      if (!data.Amount && lineVals.length) {
        data.Amount = lineVals[lineVals.length - 1];
      }
    }
  }
  if (!data.Amount) {
    var cn = currencyMoneyValues(cleaned);
    if (cn.length) {
      var mx = Math.max.apply(null, cn);
      if (mx>0) { data.Amount=mx; debug.amountCandidates.push({label:'max-symbol',value:mx,source:'currency-symbol'}); }
    }
  }
  debug.chosenAmount = data.Amount || '';

  // ---- C. TaxableValue (Net Fare > Taxable Value > Base Fare) ----
  var taxablePick = chooseMoneyNearLabel([
    'taxable\\s*(?:value|amount)',
    'net\\s*fare',
    'base\\s*(?:fare|amount|value)',
    'subtotal',
    'sub\\s*total'
  ], 140);
  if (taxablePick && taxablePick.value > 0) {
    data.TaxableValue = taxablePick.value;
    debug.taxableCandidate = taxablePick.label + ' = ' + taxablePick.value;
  }
  if (!data.TaxableValue) {
    var basisM = cleaned.match(/(?:sgst|cgst|igst)[^\n]*basis[^\n]*(?:\n\s*[^\n]*)?/i);
    if (basisM) {
      var basisVals = currencyMoneyValues(basisM[0]);
      if (basisVals.length) {
        data.TaxableValue = basisVals[0];
        debug.taxableCandidate = 'GST basis = ' + data.TaxableValue;
      }
    }
  }

  // ---- D. GSTAmount — avoid GST rates; pick the tax amount, not 9.00/18.00 percentages ----
  function extractGstLineAmount(label) {
    var lower = cleaned.toLowerCase();
    var lowerLabel = label.toLowerCase();
    var idx = lower.indexOf(lowerLabel);
    if (idx === -1) return 0;

    // IGST special case: scan ALL occurrences and return the maximum valid amount.
    // Multi-item invoices show per-row IGST (e.g. ₹2 for cheapest item) before the
    // total IGST row (e.g. ₹5269). A 180-char first-match window misses the total.
    if (lowerLabel === 'igst') {
      var taxable = data.TaxableValue ? parseMoney(data.TaxableValue) : 0;
      // IGST must be less than the taxable base (it is a % of it). If taxable not
      // yet known, use 50% of Amount as a safe upper bound (even 28% GST < 22% of total).
      var upperBound = taxable > 0 ? taxable
                       : (data.Amount ? parseMoney(data.Amount) * 0.5 : 0);
      var igstRe = /\bigst\b[^\n]{0,200}/gi;
      var igM, allIgst = [];
      while ((igM = igstRe.exec(cleaned)) !== null) {
        var snip = igM[0].replace(/\d+(?:\.\d+)?\s*%/g, ' ');
        var vs = currencyMoneyValues(snip);
        if (!vs.length) vs = moneyValues(snip);
        vs.forEach(function(v) {
          if (v > 0 && (upperBound <= 0 || v < upperBound)) allIgst.push(v);
        });
      }
      return allIgst.length ? Math.max.apply(null, allIgst) : 0;
    }

    var windowText = cleaned.substring(idx, Math.min(cleaned.length, idx + 180));
    var stopRe = lowerLabel === 'sgst'
      ? /\bcgst\b|\bigst\b|\btotal\s+(?:price|amount|fare|payable|due)\b|\bpayment\b|\bamount\s+paid\b/i
      : lowerLabel === 'cgst'
        ? /\bsgst\b|\bigst\b|\btotal\s+(?:price|amount|fare|payable|due)\b|\bpayment\b|\bamount\s+paid\b/i
        : /\bcgst\b|\bsgst\b|\btotal\s+(?:price|amount|fare|payable|due)\b|\bpayment\b|\bamount\s+paid\b/i;
    var afterLabel = windowText.substring(label.length);
    var stop = afterLabel.search(stopRe);
    var snippet = label + (stop >= 0 ? afterLabel.substring(0, stop) : afterLabel);

    snippet = snippet.replace(/\d+(?:\.\d+)?\s*%/g, ' ');
    var vals = currencyMoneyValues(snippet);
    if (!vals.length) vals = moneyValues(snippet);
    vals = vals.filter(function(v) {
      return v > 0 && (!data.Amount || v < data.Amount);
    });
    if (vals.length >= 2) return vals[vals.length - 1]; // basis, tax
    return vals.length === 1 ? vals[0] : 0;
  }
  var gc = extractGstLineAmount('cgst');
  var gs = extractGstLineAmount('sgst');
  var ig = extractGstLineAmount('igst');
  if (ig > 0) {
    data.IGSTAmount = Math.round(ig * 100) / 100;
    data.GSTAmount  = data.IGSTAmount;
    debug.gstCandidate = 'IGST ' + data.IGSTAmount;
  } else if (gc > 0 || gs > 0) {
    data.CGSTAmount = Math.round(gc * 100) / 100;
    data.SGSTAmount = Math.round(gs * 100) / 100;
    data.GSTAmount  = Math.round((gc + gs) * 100) / 100;
    debug.gstCandidate = 'CGST ' + gc + ' + SGST ' + gs + ' = ' + data.GSTAmount;
  }
  if ((!data.TaxableValue || parseMoney(data.TaxableValue) <= 0) &&
      data.Amount && data.GSTAmount && data.Amount > data.GSTAmount) {
    data.TaxableValue = Math.round((data.Amount - data.GSTAmount) * 100) / 100;
    debug.taxableCandidate = 'Amount minus GST = ' + data.TaxableValue;
  }

  // ---- D2. PaymentMode ----
  if (/american\s*express|visa|master\s*card|mastercard|rupay|card\s*brand|debit\s*card|credit\s*card|\bcard\b/i.test(cleaned)) {
    data.PaymentMode = 'Card';
  } else if (/\bupi\b|gpay|google\s*pay|phonepe|paytm/i.test(cleaned)) {
    data.PaymentMode = 'UPI';
  } else if (/\bcash\b/i.test(cleaned)) {
    data.PaymentMode = 'Cash';
  } else if (/\bneft\b/i.test(cleaned)) {
    data.PaymentMode = 'NEFT';
  } else if (/\bimps\b/i.test(cleaned)) {
    data.PaymentMode = 'IMPS';
  } else if (/cheque|check/i.test(cleaned)) {
    data.PaymentMode = 'Cheque';
  }

  // ---- E. VendorOrPerson ----
  var isGarbage = function(s) {
    if (!s||s.length<3||s.length>80) return true;
    if (/^(?:tally\s*prime|accounting\s*voucher\s*display|identity|adobe|windows)$/i.test(s.trim())) return true;
    if (/:\/\//.test(s)||/\bwww\./i.test(s)) return true;      // URLs
    if (/^\+?[\d\s\-\(\)]{7,}$/.test(s)) return true;          // phone numbers
    if (/@/.test(s)) return true;                               // emails
    if (/[<>]|base64|charset|vnd\.|image\/|application\//i.test(s)) return true;
    var alphas = (s.match(/[a-zA-Z]/g)||[]).length;
    var words = s.trim().split(/\s+/).filter(Boolean).length;
    if (alphas/s.length < 0.55) return true;                    // >45% non-alpha = OCR garbage
    if (words < 2 && !/(pvt\.?\s*ltd\.?|private\s*limited|llp|limited|inc\.)/i.test(s)) return true;
    return false;
  };

  function addVendorCandidate(list, value, reason, indexHint) {
    var v = String(value || '').trim().replace(/\s+/g, ' ');
    v = v.replace(/^(?:business\s+receipt|tax\s+invoice|invoice|receipt|bill)\s+[A-Z]\s+/i, '').trim();
    v = v.replace(/^(?:business\s+receipt|tax\s+invoice|invoice|receipt|bill)\s+/i, '').trim();
    v = v.replace(/^(?:seller|supplier|vendor|merchant|store|hotel|airline|bill\s*from|sold\s*by|m\/s)\s*:?\s*/i, '').trim();
    v = v.replace(/^(?:policy\s+terms?\s+(?:and\s+)?conditions?|terms?\s+(?:and\s+)?conditions?|cancellation\s+policy|privacy\s+policy|user\s+agreement|registered\s+address|business\s+name|bill\s*to|ship\s*to|buyer|customer|recipient)\s*:?\s*/i, '').trim();
    if (!v || isGarbage(v)) return;
    var score = 10;
    if (/seller|supplier|vendor|merchant|store|hotel|airline|bill\s*from|sold\s*by|m\/s/i.test(reason)) score += 40;
    if (/(pvt\.?\s*ltd\.?|private\s*limited|llp|limited|inc\.|airways|airlines|hotel|resort|travels|taxi|cab|store)/i.test(v)) score += 20;
    if (indexHint !== undefined && indexHint < 800) score += 12;
    if (/business\s+name|contact\s+person|bill\s*to|ship\s*to|buyer|customer|recipient/i.test(reason)) score -= 50;
    if (/registered\s+address|terms|conditions|policy|support|help/i.test(reason)) score -= 15;
    list.push({ value: v, reason: reason, score: score, index: indexHint || 0 });
  }

  var vendorList = [];

  // Priority 1: explicit seller/vendor labels.
  var vendorLabelRe = /(?:seller|supplier|vendor|merchant|store|hotel|airline|bill\s*from|sold\s*by|m\/s)\s*:?\s*([^\n,]{3,80})/ig;
  var vl;
  while ((vl = vendorLabelRe.exec(cleaned)) !== null) {
    addVendorCandidate(vendorList, vl[1], 'label ' + vl[0].substring(0, 24), vl.index);
  }

  // Priority 2: company name ending in legal/trade suffix.
  var coRe = /([A-Z][A-Za-z &\.\-]{2,50}(?:Pvt\.?\s*Ltd\.?|Private\s*Limited|LLP|LLC|Limited|Inc\.))/g;
  var coM, coList = [];
  while ((coM = coRe.exec(cleaned)) !== null) {
    var co = coM[1].trim().replace(/\s+/g,' ');
    if (!isGarbage(co)) {
      coList.push(co);
      var context = cleaned.substring(Math.max(0, coM.index - 60), coM.index + co.length + 60);
      addVendorCandidate(vendorList, co, context, coM.index);
    }
  }
  debug.vendorCandidates = coList.slice();

  // Priority 3: first meaningful non-customer header line.
  for (var li=0; li<Math.min(12,lines.length); li++) {
    var lc = lines[li].substring(0,80);
    debug.vendorCandidates.push('(ln'+li+') '+lc);
    if (/[a-zA-Z]{4,}/.test(lc) &&
        !/^(?:tax\s*invoice|invoice\b|receipt\b|bill\b|page\s*\d|total|inclusive|business\s+name|contact\s+person|bill\s*to|ship\s*to|buyer|customer|email|gstin|pan|address|phone|mobile|https?:|www\.)/i.test(lc) &&
        !isGarbage(lc)) {
      addVendorCandidate(vendorList, lc, 'header line', cleaned.indexOf(lines[li]));
    }
  }

  vendorList.sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });
  debug.vendorCandidates = debug.vendorCandidates.concat(vendorList.map(function(v) {
    return '(' + v.score + ') ' + v.value + ' [' + v.reason.substring(0, 40) + ']';
  }));
  if (vendorList.length) data.VendorOrPerson = vendorList[0].value;

  if (data.VendorOrPerson && isGarbage(data.VendorOrPerson)) {
    debug.vendorCandidates.push('(rejected) ' + data.VendorOrPerson);
    data.VendorOrPerson = '';
  }
  debug.chosenVendor = data.VendorOrPerson || '';

  // ---- F. BillAvailable ----
  if (/tax\s*invoice|invoice\s*(?:no|number)|bill\s*(?:no|number)/i.test(cleaned)) {
    data.BillAvailable = 'Yes';
  }

  // ---- G. Notes: Invoice No / Booking No / SAC / Place of Supply / GSTIN ----
  var invM = cleaned.match(/invoice\s*(?:no\.?|number|#)\s*:?\s*([A-Z0-9\/\-]{3,25})/i) ||
             cleaned.match(/bill\s*(?:no\.?|number|#)\s*:?\s*([A-Z0-9\/\-]{3,25})/i);
  if (invM) {
    data.BillNo = invM[1].trim();
    notes.push('Invoice No: '+data.BillNo);
  }
  var bkM = cleaned.match(/booking\s*(?:no\.?|number|id|ref)\s*:?\s*([A-Z0-9\/\-]{3,25})/i);
  if (bkM) notes.push('Booking No: '+bkM[1].trim());
  var sacM = cleaned.match(/sac\s*(?:code)?\s*:?\s*(\d{4,8})/i);
  if (sacM) notes.push('SAC: '+sacM[1]);
  var posM = cleaned.match(/place\s*of\s*supply\s*:?\s*([^\n]{3,40})/i);
  if (posM) notes.push('Place of Supply: '+posM[1].trim());
  var gsM = cleaned.match(/\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/);
  if (gsM) { data.VendorGSTIN=gsM[1]; notes.push('GSTIN: '+gsM[1]); }
  debug.notesExtracted = notes.join(' | ');

  // ---- H. ExpenseType + Category + Description ----
  var expType='Misc', cat='Misc', desc='Invoice-based expense';
  if (/hotel|stay|lodge|oyo|airbnb|inn|resort|accomm?odation|accommdation/.test(lo)) {
    expType='Accommodation'; cat='Hotel Stay';    desc='Hotel expense';
  } else if (/flight|airline|airway|iata|ticket\s*cancel|boarding|pnr|travel\s*agent|tour.*travel/.test(lo)) {
    expType='Travel';        cat='Air Travel';    desc='Air travel expense';
  } else if (/taxi|cab|uber|ola|rapido|auto\s*rick|meru|megacab/.test(lo)) {
    expType='Travel';        cat='Taxi';          desc='Travel expense';
  } else if (/restaurant|cafe|swiggy|zomato|food|dining|lunch|dinner|breakfast|dhaba/.test(lo)) {
    expType='Food';          cat='Meals';         desc='Food expense';
  } else if (/stationery|office\s*supplies|paper|printer|ink|toner/.test(lo)) {
    expType='Office';        cat='Stationery';    desc='Office purchase';
  } else if (/consultant|freelancer|professional\s*services|advisory|retainer/.test(lo)) {
    expType='Vendor';        cat='Consulting';    desc='Consulting expense';
  }
  data.ExpenseType = expType;
  data.Category    = cat;
  // Prefer ServiceDescription field from invoice; fall back to context-based description
  var svcM = cleaned.match(/service\s*desc(?:ription)?\s*:?\s*([^\n]{3,60})/i);
  if (svcM) {
    data.Description = cat + ' - ' + svcM[1].trim().replace(/\s+/g,' ');
  } else if (cat==='Taxi' && /airport/i.test(cleaned)) {
    data.Description = 'Airport taxi';
  } else {
    data.Description = desc;
  }

  // ---- I. BillingMonth ----
  if (data.Date) {
    data.BillingMonth = billingMonthFromIso_(data.Date);
  }

  // ---- J. Notes assembly ----
  data.Notes = notes.join(' | ');

  var weakText = textQuality.alphaRatio < 0.22 || textQuality.noisyRatio > 0.12 || lines.length < 3;
  var looksLikePdfMetadataOnly = !data.Amount &&
    /(?:tally\s*prime|accounting\s*voucher\s*display|\/type\s*\/catalog|\/pages|\/font|\/xobject|endstream)/i.test(cleaned.substring(0, 1200));
  if (weakText && !data.Amount && !data.Date) {
    data.VendorOrPerson = '';
    debug.chosenVendor = '';
  }
  if (looksLikePdfMetadataOnly) {
    data.Date = '';
    data.VendorOrPerson = '';
    debug.chosenDate = '';
    debug.chosenVendor = '';
    debug.metadataOnlyRejected = true;
  }
  var hasStrongVendor = !!data.VendorOrPerson && /(\s|pvt\.?\s*ltd\.?|private\s*limited|llp|limited|inc\.|hotel|airways|airlines|travels|taxi|store)/i.test(data.VendorOrPerson);
  var confidence = invoiceParserConfidence_(data, debug);
  debug.confidence = confidence;
  if (!confidence.strong) {
    if (!data.Date) data.BillingMonth = '';
    if (!data.Amount) {
      data.TaxableValue = '';
      data.GSTAmount = '';
    }
    if (!data.VendorOrPerson || (!data.Date && !data.Amount)) {
      data.PaymentMode = '';
      data.ExpenseType = data.ExpenseType || 'Misc';
      data.Category = data.Category || 'Misc';
      if (data.Description === 'Invoice-based expense') data.Description = '';
    }
  }

  // ---- K. Minimum confidence check ----
  if (!data.Date && !data.Amount && !data.VendorOrPerson) {
    Logger.log('[AI Fill fallback debug] ' + JSON.stringify(debug));
    return { ok: false, errorType: 'fallback_failed',
             _debug: debug,
             hint: 'Try a clearer image/PDF with visible date, vendor, and total amount.',
             message: 'Could not extract enough details. Please enter manually.' };
  }

  if (!data.Amount && !data.Date && !hasStrongVendor) {
    Logger.log('[AI Fill fallback debug] ' + JSON.stringify(debug));
    return { ok: false, errorType: 'fallback_failed',
             _debug: debug,
             hint: 'Try a clearer image/PDF with visible date, vendor, and total amount.',
             message: 'Could not extract enough details. Please enter manually.' };
  }
  if (!confidence.usable) {
    Logger.log('[AI Fill fallback debug] ' + JSON.stringify(debug));
    return { ok: false, errorType: 'fallback_failed',
             _debug: debug,
             hint: 'Try a clearer image/PDF with visible date, vendor, and total amount.',
             message: 'Could not extract enough details. Please enter manually.' };
  }

  Logger.log('[AI Fill fallback debug] ' + JSON.stringify(debug));
  return { ok: true, source: 'fallback', data: data, _debug: debug };
}

// Simple zero-pad helper
function pad2(n) { return n < 10 ? '0' + n : String(n); }

// ---------------------------------------------------------------------------
// testParseInvoiceWithAIFromDrive - editor-friendly helper for manual testing.
// Usage in GAS editor:
//   testParseInvoiceWithAIFromDrive('YOUR_DRIVE_FILE_ID')
// ---------------------------------------------------------------------------
function testParseInvoiceWithAIFromDrive(fileId) {
  if (!fileId) {
    return {
      ok: false,
      error: 'Missing fileId',
      hint: "Run testParseInvoiceWithAIFromDrive('DRIVE_FILE_ID')"
    };
  }

  var file = DriveApp.getFileById(fileId);
  var blob = file.getBlob();
  var base64 = Utilities.base64Encode(blob.getBytes());
  var mimeType = blob.getContentType() || file.getMimeType() || 'application/pdf';

  var result = parseInvoiceWithAI({ base64: base64, mimeType: mimeType });
  Logger.log('[AI Fill test result] ' + JSON.stringify(result));
  return result;
}

// Run once from the Apps Script editor after adding the documents OAuth scope.
// This forces Google to show the authorization prompt needed by Drive OCR.
function authorizeOcrPermissions() {
  var doc = DocumentApp.create('Zivara OCR Permission Check');
  var docId = doc.getId();
  doc.getBody().appendParagraph('OCR permission check');
  DocumentApp.openById(docId).getBody().getText();
  DriveApp.getFileById(docId).setTrashed(true);
  return 'OCR permissions authorized';
}
