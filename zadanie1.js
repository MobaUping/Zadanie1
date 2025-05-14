const https = require('https');
const fs = require('fs');

// Конфигурация
const config = {
  // Коды валют, для которых нужно загрузить историю
  currencyCodes: ['USD', 'EUR', 'GBP', 'CNY', 'JPY'],
  // Пути для сохранения файлов
  outputPaths: {
    currencies: 'currencies.csv',
    rates: 'currency_rates.csv'
  },
  // URL API ЦБР
  apiUrls: {
    currencies: 'https://www.cbr.ru/scripts/XML_valFull.asp',
    dailyRates: 'https://www.cbr.ru/scripts/XML_daily.asp',
    historicalRates: (date) => `https://www.cbr.ru/scripts/XML_daily.asp?date_req=${date}`
  }
};

// Функция для получения данных по URL
function fetchData(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        resolve(data);
      });
      
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Функция для извлечения данных из XML (простая реализация)
function extractCurrencyData(xml) {
  const items = [];
  const itemRegex = /<Item[^>]*>([\s\S]*?)<\/Item>/g;
  let itemMatch;
  
  while ((itemMatch = itemRegex.exec(xml)) !== null) {
    const itemContent = itemMatch[1];
    const idMatch = itemMatch[0].match(/ID="([^"]+)"/);
    const id = idMatch ? idMatch[1] : '';
    
    const getValue = (tag) => {
      const match = itemContent.match(new RegExp(`<${tag}>([^<]+)<\/${tag}>`));
      return match ? match[1] : '';
    };
    
    items.push({
      id: id,
      code: getValue('CharCode'),
      name: getValue('Name'),
      engName: getValue('EngName'),
      nominal: getValue('Nominal'),
      parentCode: getValue('ParentCode') || ''
    });
  }
  
  return items;
}

// Функция для извлечения курсов валют из XML
function extractRatesData(xml, date) {
  const rates = [];
  const valuteRegex = /<Valute[^>]*>([\s\S]*?)<\/Valute>/g;
  let valuteMatch;
  
  while ((valuteMatch = valuteRegex.exec(xml)) !== null) {
    const valuteContent = valuteMatch[1];
    const idMatch = valuteMatch[0].match(/ID="([^"]+)"/);
    const id = idMatch ? idMatch[1] : '';
    
    const getValue = (tag) => {
      const match = valuteContent.match(new RegExp(`<${tag}>([^<]+)<\/${tag}>`));
      return match ? match[1] : '';
    };
    
    const charCode = getValue('CharCode');
    
    rates.push({
      date: date,
      currencyCode: charCode,
      nominal: getValue('Nominal'),
      value: parseFloat(getValue('Value').replace(',', '.')),
      vunitRate: parseFloat(getValue('VunitRate').replace(',', '.'))
    });
  }
  
  return rates;
}

// Функция для форматирования даты в формат DD/MM/YYYY
function formatDate(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// Функция для получения дат за последние 30 дней
function getLast30Days() {
  const dates = [];
  for (let i = 0; i < 30; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    dates.push(formatDate(date));
  }
  return dates;
}

// Основная функция
async function main() {
  try {
    // 1. Загрузка и сохранение справочника валют
    console.log('Загрузка справочника валют...');
    const currenciesXml = await fetchData(config.apiUrls.currencies);
    const currencies = extractCurrencyData(currenciesXml);
    
    // Добавляем флаг истории
    const currenciesWithFlag = currencies.map(currency => ({
      ...currency,
      flagHistory: config.currencyCodes.includes(currency.code) ? 1 : 0
    }));
    
    // Создаем CSV для справочника валют
    let currenciesCsv = 'ID,Code,Name,EngName,Nominal,ParentCode,FlagHistory\n';
    currenciesWithFlag.forEach(currency => {
      currenciesCsv += `${currency.id},${currency.code},"${currency.name}","${currency.engName}",${currency.nominal},${currency.parentCode},${currency.flagHistory}\n`;
    });
    
    fs.writeFileSync(config.outputPaths.currencies, currenciesCsv);
    console.log(`Справочник валют сохранен в ${config.outputPaths.currencies}`);
    
    // 2. Загрузка исторических данных по курсам валют
    console.log('Загрузка исторических данных по курсам...');
    const dates = getLast30Days();
    let allRates = [];
    
    for (const date of dates) {
      console.log(`Загрузка данных за ${date}...`);
      try {
        const ratesXml = await fetchData(config.apiUrls.historicalRates(date));
        const dateMatch = ratesXml.match(/<ValCurs Date="([^"]+)"/);
        const currentDate = dateMatch ? dateMatch[1] : date;
        
        const rates = extractRatesData(ratesXml, currentDate)
          .filter(rate => config.currencyCodes.includes(rate.currencyCode));
        
        allRates = allRates.concat(rates);
        
        // Задержка между запросами
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Ошибка при загрузке данных за ${date}:`, error.message);
      }
    }
    
    // Создаем CSV для исторических данных
    let ratesCsv = 'Date,CurrencyCode,Nominal,Value,VunitRate\n';
    allRates.forEach(rate => {
      ratesCsv += `${rate.date},${rate.currencyCode},${rate.nominal},${rate.value},${rate.vunitRate}\n`;
    });
    
    fs.writeFileSync(config.outputPaths.rates, ratesCsv);
    console.log(`Исторические данные по курсам сохранены в ${config.outputPaths.rates}`);
    
    console.log('Готово!');
    
  } catch (error) {
    console.error('Произошла ошибка:', error);
  }
}

// Запуск программы
main();