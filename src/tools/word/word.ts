import JSZip from "jszip";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

// 取得當前文件目錄
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 取得專案根目錄
const projectRoot = path.resolve(__dirname, '../../../');

// 定義路徑
const DOCX_DIR = path.join(projectRoot, 'docx');
const TEMPLATE_PATH = path.join(DOCX_DIR, 'example.docx');

// 確保 docx 目錄存在
if (!fs.existsSync(DOCX_DIR)) {
  fs.mkdirSync(DOCX_DIR, { recursive: true });
}

/**
 * 請假申請單參數介面
 */
export type LeaveApplicationParams = {
  /** 申請人姓名 */
  applicant: string;
  /** 申請日期 (格式: YYYY-MM-DD，可選，預設為今天) */
  applicationDate?: string;
  /** 代理人姓名 (可選) */
  proxy?: string;
  /** 請假事由 */
  reason: string;
  /** 請假類型 (如: 事假、病假、特休、年假等) */
  leaveType: string;
  /** 開始日期 (格式: YYYY-MM-DD) */
  startDate: string;
  /** 開始時間 (格式: HH:mm) */
  startTime: string;
  /** 結束日期 (格式: YYYY-MM-DD) */
  endDate: string;
  /** 結束時間 (格式: HH:mm) */
  endTime: string;
  /** 請假時數 */
  totalHours: number;
}

/**
 * 函數回傳結果介面
 */
export type ProcessResult = {
  success: boolean;
  message: string;
  fileBuffer?: Buffer; // Changed from outputPath to fileBuffer
  details?: {
    applicant: string;
    applicationDate: string;
    leaveType: string;
    reason: string;
    startDateTime: string;
    endDateTime: string;
    totalHours: number;
    proxy?: string;
  };
}

/**
 * 修改請假申請單
 */
export async function modifyLeaveApplication(params: LeaveApplicationParams): Promise<ProcessResult> {
  try {
    console.log("Entering modifyLeaveApplication with params:", params);
    // 驗證必要參數
    const requiredFields: (keyof LeaveApplicationParams)[] = [
      'applicant', 'reason', 'leaveType', 'startDate', 'startTime', 'endDate', 'endTime', 'totalHours'
    ];
    
    for (const field of requiredFields) {
      if (!params[field]) {
        throw new Error(`缺少必要參數: ${field}`);
      }
    }

    // 驗證時數
    if (params.totalHours <= 0) {
      throw new Error('請假時數必須大於 0');
    }

    // 設定檔案路徑
    const inputPath = TEMPLATE_PATH;
    
    if (!fs.existsSync(inputPath)) {
      throw new Error(`找不到範本檔案：${inputPath}`);
    }
    
    console.log(`開始處理請假申請單...`);
    console.log(`範本檔案: ${inputPath}`);
    
    const data = fs.readFileSync(inputPath);
    const zip = await JSZip.loadAsync(data);
    
    const documentFile = zip.file("word/document.xml");
    if (!documentFile) {
      throw new Error("找不到 word/document.xml 檔案");
    }
    
    let xmlContent = await documentFile.async("string");
    
    // 處理日期時間
    const applicationDate = params.applicationDate || getCurrentDate();
    const applicationDateFormatted = formatToROCDate(applicationDate);
    const startDateTime = combineDateTime(params.startDate, params.startTime);
    const endDateTime = combineDateTime(params.endDate, params.endTime);
    const startDateTimeFormatted = formatToROCDateTime(startDateTime);
    const endDateTimeFormatted = formatToROCDateTime(endDateTime);
    
    console.log("找到檔案，開始修改...");
    
    const reasonWithLineBreaks = params.reason.replace(/\n/g, '</w:t><w:br/><w:t>');

    // 建立欄位替換規則
    const replacements = [
      {
        name: '申請日期',
        pattern: /114年\s*6月\s*30\s*日/g,
        value: applicationDateFormatted
      },
      {
        name: '申請人',
        pattern: /(<w:t>申請人<\/w:t><\/w:r><\/w:p><\/w:tc><w:tc[^>]*><w:tcPr[^>]*>.*?<\/w:tcPr><w:p[^>]*>)(.*?)(<\/w:p><\/w:tc>)/s,
        value: params.applicant,
        isTableCell: true
      },
      {
        name: '請假事由',
        pattern: /(<w:t>請假事由<\/w:t><\/w:r><\/w:p><\/w:tc><w:tc[^>]*>.*?<w:p[^>]*>)(.*?)(<\/w:p><\/w:tc>)/s,
        value: reasonWithLineBreaks,
        isTableCell: true
      },
      {
        name: '請假類型',
        pattern: /(<w:t>請假類型<\/w:t><\/w:r><\/w:p><\/w:tc><w:tc[^>]*>.*?<w:p[^>]*>)(.*?)(<\/w:p><\/w:tc>)/s,
        value: params.leaveType,
        isTableCell: true
      },
      {
        name: '開始時間',
        pattern: /(<w:t>開始時間<\/w:t><\/w:r><\/w:p><\/w:tc><w:tc[^>]*>.*?<w:p[^>]*>)(.*?)(<\/w:p><\/w:tc>)/s,
        value: startDateTimeFormatted,
        isTableCell: true
      },
      {
        name: '結束時間',
        pattern: /(<w:t>結束時間<\/w:t><\/w:r><\/w:p><\/w:tc><w:tc[^>]*>.*?<w:p[^>]*>)(.*?)(<\/w:p><\/w:tc>)/s,
        value: endDateTimeFormatted,
        isTableCell: true
      },
      {
        name: '請假時數',
        pattern: /(<w:t>請假時數<\/w:t><\/w:r><\/w:p><\/w:tc><w:tc[^>]*>.*?<w:p[^>]*>)(.*?)(<\/w:p><\/w:tc>)/s,
        value: `${params.totalHours} 小時`,
        isTableCell: true
      }
    ];
    
    // 處理代理人（可選）
    if (params.proxy) {
      replacements.push({
        name: '代理人',
        pattern: /(<w:t>代理人<\/w:t><\/w:r><\/w:p><\/w:tc><w:tc[^>]*>.*?<w:p[^>]*>)(.*?)(<\/w:p><\/w:tc>)/s,
        value: params.proxy,
        isTableCell: true
      });
    }
    
    // 執行所有替換
    for (const replacement of replacements) {
      if (replacement.isTableCell) {
        xmlContent = replaceTableCell(xmlContent, replacement.pattern, replacement.value);
        console.log(`✓ 已更新${replacement.name}: ${replacement.value}`);
      } else {
        xmlContent = xmlContent.replace(replacement.pattern, replacement.value);
        console.log(`✓ 已更新${replacement.name}: ${replacement.value}`);
      }
    }
    
    // 更新zip中的文件
    zip.file("word/document.xml", xmlContent);
    
    // 生成新的docx文件的Buffer數據
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    
    const details = {
      applicant: params.applicant,
      applicationDate: applicationDateFormatted,
      leaveType: params.leaveType,
      reason: params.reason,
      startDateTime: startDateTimeFormatted,
      endDateTime: endDateTimeFormatted,
      totalHours: params.totalHours,
      ...(params.proxy && { proxy: params.proxy })
    };
    
    console.log("✅ 請假申請單已成功產生 (in-memory)");
    
    return {
      success: true,
      message: "請假申請單已成功產生",
      details,
      fileBuffer: buffer // 返回Buffer數據而不是文件路徑
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "未知錯誤";
    console.error("修改失敗:", errorMessage);
    
    return {
      success: false,
      message: `修改失敗: ${errorMessage}`
    };
  }
}

/**
 * 替換表格單元格內容
 */
function replaceTableCell(xmlContent: string, pattern: RegExp, value: string): string {
  return xmlContent.replace(pattern, (match, before, middle, after) => {
    if (!middle.includes('<w:t>')) {
      const newMiddle = `<w:r><w:rPr><w:rFonts w:ascii="KaiTi" w:hAnsi="KaiTi" w:eastAsia="KaiTi"/><w:kern w:val="0"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US" w:eastAsia="zh-TW" w:bidi="ar-SA"/></w:rPr><w:t>${value}</w:t></w:r>`;
      return before + newMiddle + after;
    }
    return match;
  });
}

/**
 * 取得當前日期 (YYYY-MM-DD 格式)
 */
function getCurrentDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * 組合日期和時間
 */
function combineDateTime(date: string, time: string): string {
  return `${date} ${time}`;
}

/**
 * 將日期格式化為民國年
 */
function formatToROCDate(dateString: string): string {
  const date = new Date(dateString);
  const rocYear = date.getFullYear() - 1911;
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${rocYear}年 ${month}月 ${day} 日`;
}

/**
 * 將日期時間格式化為民國年格式
 */
function formatToROCDateTime(dateTimeString: string): string {
  const [datePart, timePart] = dateTimeString.split(' ');
  const date = new Date(datePart);
  const rocYear = date.getFullYear() - 1911;
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  
  return `${rocYear}年 ${month}月 ${day}日 ${timePart}`;
}

/**
 * 驗證日期格式 (YYYY-MM-DD)
 */
function isValidDate(dateString: string): boolean {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) return false;
  
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * 驗證時間格式 (HH:mm)
 */
function isValidTime(timeString: string): boolean {
  const regex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  return regex.test(timeString);
}

/**
 * 驗證請假申請參數
 */
export function validateParams(params: LeaveApplicationParams): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!isValidDate(params.startDate)) {
    errors.push('開始日期格式錯誤，請使用 YYYY-MM-DD 格式');
  }
  
  if (!isValidDate(params.endDate)) {
    errors.push('結束日期格式錯誤，請使用 YYYY-MM-DD 格式');
  }
  
  if (!isValidTime(params.startTime)) {
    errors.push('開始時間格式錯誤，請使用 HH:mm 格式');
  }
  
  if (!isValidTime(params.endTime)) {
    errors.push('結束時間格式錯誤，請使用 HH:mm 格式');
  }
  
  if (params.applicationDate && !isValidDate(params.applicationDate)) {
    errors.push('申請日期格式錯誤，請使用 YYYY-MM-DD 格式');
  }
  
  if (params.totalHours <= 0) {
    errors.push('請假時數必須大於 0');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}


// 使用範例
async function example(): Promise<void> {
  try {
    // 模擬前端表單資料
    const formData: LeaveApplicationParams = {
      applicant: "張三",
      applicationDate: "2025-07-15", // 可選
      proxy: "李四", // 可選
      reason: "家庭聚會",
      leaveType: "事假",
      startDate: "2025-07-20",
      startTime: "09:00",
      endDate: "2025-07-20",
      endTime: "17:00",
      totalHours: 8
    };
    
    // 驗證參數
    const validation = validateParams(formData);
    if (!validation.valid) {
      console.error("參數驗證失敗:", validation.errors);
      return;
    }
    
    const result = await modifyLeaveApplication(formData);
    
    if (result.success && result.fileBuffer) {
      console.log("成功:", result.message);
      console.log("收到檔案 Buffer，大小:", result.fileBuffer.length, "bytes");
      console.log("詳細資訊:", result.details);
    } else {
      console.error("失敗:", result.message);
    }
    
  } catch (error) {
    console.error("執行失敗:", error);
  }
}

// 匯出格式化函數（可能在其他地方需要）
export {
  formatToROCDate,
  formatToROCDateTime
};

// 如果直接執行此文件
if (import.meta.url === `file://${process.argv[1]}`) {
  example();
}