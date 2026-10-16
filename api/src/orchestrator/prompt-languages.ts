/**
 * Language-specific instructions for Claude prompts.
 *
 * Each entry is a sentence in the TARGET language telling Claude
 * to write reports in that language. Placed at the very top of
 * the prompt so it has maximum weight.
 *
 * English is omitted — Claude defaults to English, no instruction needed.
 */
const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  // Slavic
  uk: 'Якщо в результаті твоєї роботи тобі доведеться писати звіти у .md форматі — переконайся що вони написані Українською мовою, це важливо. Пиши природною українською — не перекладай дослівно з англійської. Уникай конструкцій типу "Це є сучасний" (калька з "This is a modern"). Використовуй живу професійну мову, легкий тон, без канцеляризмів.',
  pl: 'Jeśli w ramach swojej pracy będziesz musiał pisać raporty w formacie .md — upewnij się, że są napisane po Polsku, to jest ważne.',
  cs: 'Pokud budeš v rámci své práce psát reporty ve formátu .md — ujisti se, že jsou napsané v Češtině, je to důležité.',
  sk: 'Ak budeš v rámci svojej práce písať reporty vo formáte .md — uisti sa, že sú napísané po Slovensky, je to dôležité.',
  bg: 'Ако в хода на работата ти се наложи да пишеш доклади във формат .md — увери се, че са написани на Български, това е важно.',
  hr: 'Ako tijekom svog rada budeš morao pisati izvješća u .md formatu — pobrinite se da su napisana na Hrvatskom, to je važno.',
  lt: 'Jei darbo metu reikės rašyti ataskaitas .md formatu — įsitikink, kad jos parašytos Lietuvių kalba, tai svarbu.',
  lv: 'Ja darba gaitā tev būs jāraksta atskaites .md formātā — pārliecinies, ka tās ir rakstītas Latviešu valodā, tas ir svarīgi.',
  et: 'Kui sa pead oma töö käigus kirjutama aruandeid .md formaadis — veendu, et need on kirjutatud Eesti keeles, see on oluline.',
  // Germanic
  de: 'Wenn du im Rahmen deiner Arbeit Berichte im .md-Format schreiben musst — stelle sicher, dass sie auf Deutsch verfasst sind, das ist wichtig.',
  nl: 'Als je tijdens je werk rapporten in .md-formaat moet schrijven — zorg ervoor dat ze in het Nederlands zijn geschreven, dit is belangrijk.',
  sv: 'Om du under ditt arbete behöver skriva rapporter i .md-format — se till att de är skrivna på Svenska, det är viktigt.',
  no: 'Hvis du i løpet av arbeidet ditt må skrive rapporter i .md-format — sørg for at de er skrevet på Norsk, dette er viktig.',
  da: 'Hvis du i løbet af dit arbejde skal skrive rapporter i .md-format — sørg for at de er skrevet på Dansk, det er vigtigt.',
  // Romance
  fr: 'Si dans le cadre de ton travail tu dois rédiger des rapports au format .md — assure-toi qu\'ils sont rédigés en Français, c\'est important.',
  es: 'Si en el transcurso de tu trabajo necesitas escribir informes en formato .md — asegúrate de que estén escritos en Español, esto es importante.',
  pt: 'Se no decorrer do seu trabalho você precisar escrever relatórios em formato .md — certifique-se de que estejam escritos em Português, isso é importante.',
  it: 'Se nel corso del tuo lavoro dovrai scrivere report in formato .md — assicurati che siano scritti in Italiano, è importante.',
  ro: 'Dacă în cadrul muncii tale va trebui să scrii rapoarte în format .md — asigură-te că sunt scrise în limba Română, este important.',
  // Uralic
  fi: 'Jos työsi aikana sinun täytyy kirjoittaa raportteja .md-muodossa — varmista, että ne on kirjoitettu Suomeksi, tämä on tärkeää.',
  hu: 'Ha a munkád során .md formátumú jelentéseket kell írnod — győződj meg róla, hogy Magyarul írod őket, ez fontos.',
  // Turkic
  tr: 'Çalışman sırasında .md formatında raporlar yazman gerekirse — bunların Türkçe yazıldığından emin ol, bu önemli.',
  // Semitic
  he: 'אם במהלך העבודה שלך תצטרך לכתוב דוחות בפורמט .md — וודא שהם כתובים בעברית, זה חשוב.',
  ar: 'إذا كنت بحاجة أثناء عملك إلى كتابة تقارير بصيغة .md — تأكد من أنها مكتوبة باللغة العربية، هذا مهم.',
  // Indic
  hi: 'अगर आपके काम के दौरान आपको .md फॉर्मेट में रिपोर्ट लिखनी हो — तो सुनिश्चित करें कि वे हिंदी में लिखी गई हैं, यह महत्वपूर्ण है।',
  // CJK
  ja: 'あなたの作業の中で .md 形式のレポートを書く必要がある場合は、必ず日本語で書いてください。これは重要です。',
  ko: '작업 중 .md 형식의 보고서를 작성해야 하는 경우, 반드시 한국어로 작성해 주세요. 이것은 중요합니다.',
  zh: '如果你在工作中需要撰写 .md 格式的报告，请确保使用中文撰写，这很重要。',
  // Southeast Asian
  th: 'หากในระหว่างการทำงานของคุณจำเป็นต้องเขียนรายงานในรูปแบบ .md — ให้แน่ใจว่าเขียนเป็นภาษาไทย สิ่งนี้สำคัญ',
  vi: 'Nếu trong quá trình làm việc bạn cần viết báo cáo ở định dạng .md — hãy đảm bảo rằng chúng được viết bằng Tiếng Việt, điều này rất quan trọng.',
  id: 'Jika dalam pekerjaan Anda perlu menulis laporan dalam format .md — pastikan laporan tersebut ditulis dalam Bahasa Indonesia, ini penting.',
  // Hellenic
  el: 'Αν κατά τη διάρκεια της εργασίας σου χρειαστεί να γράψεις αναφορές σε μορφή .md — βεβαιώσου ότι είναι γραμμένες στα Ελληνικά, αυτό είναι σημαντικό.',
};

/**
 * Returns a language instruction for the prompt, or empty string for English.
 */
export function getLanguageInstruction(lang: string): string {
  if (!lang || lang === 'en') return '';
  return LANGUAGE_INSTRUCTIONS[lang] ?? '';
}
