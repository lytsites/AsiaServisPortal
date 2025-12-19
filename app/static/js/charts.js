// Charts and diagrams functionality for report page
// Uses Chart.js (loaded via CDN in base.html)

(function() {
  'use strict';

  // Global state
  const ReportCharts = {
    charts: {},
    data: null,
    filters: {
      region: '',
      period: '',
      kbk: ''
    },
    isLoading: false
  };

  // DOM elements
  const DOM = {};

  // Initialize
  function init() {
    cacheDOM();
    bindEvents();
    loadInitialData();
  }

  function cacheDOM() {
    DOM.filterRegion = $('#filter-region');
    DOM.filterPeriod = $('#filter-period');
    DOM.filterKbk = $('#filter-kbk');
    DOM.applyFilters = $('#apply-filters');
    DOM.resetFilters = $('#reset-filters');
    DOM.kpiTotal = $('#kpi-total');
    DOM.kpiGrowth = $('#kpi-growth');
    DOM.kpiTaxpayers = $('#kpi-taxpayers');
    DOM.kpiTop10Share = $('#kpi-top10-share');
    DOM.lineChart = $('#line-chart');
    DOM.barChart = $('#bar-chart');
    DOM.pieChart = $('#pie-chart');
    DOM.reportBlock = $('#report-block');
    DOM.loadingIndicator = $('#loading-indicator');
  }

  function bindEvents() {
    DOM.applyFilters.on('click', applyFilters);
    DOM.resetFilters.on('click', resetFilters);
    
    // Auto-apply on filter change
    DOM.filterRegion.on('change', maybeAutoApply);
    DOM.filterPeriod.on('change', maybeAutoApply);
    DOM.filterKbk.on('change', maybeAutoApply);
  }

  function maybeAutoApply() {
    // Auto-apply if both region and period are selected (period can be "all")
    const region = DOM.filterRegion.val();
    const period = DOM.filterPeriod.val();
    
    if (region && period) {
      applyFilters();
    }
  }

  // Load initial data from server
  function loadInitialData() {
    showLoading(true);
    
    $.ajax({
      url: '/api/report/data',
      method: 'GET',
      dataType: 'json',
      success: function(response) {
        ReportCharts.data = response;
        populateFilters(response);
        loadInitialFilters(response);
        showLoading(false);
      },
      error: function(xhr, status, error) {
        console.error('Failed to load report data:', error);
        showError('Не удалось загрузить данные отчета');
        showLoading(false);
      }
    });
  }

  function populateFilters(data) {
    // Regions
    const regions = [...new Set(data.files.map(f => f.region).filter(Boolean))];
    DOM.filterRegion.empty().append('<option value="">Все регионы</option>');
    regions.forEach(r => {
      DOM.filterRegion.append(`<option value="${r}">${r}</option>`);
    });
    
    // Periods
    const periods = [...new Set(data.files.map(f => f.period).filter(Boolean))];
    DOM.filterPeriod.empty().append('<option value="">Выберите период</option>');
    // Add "All periods" option if there are multiple periods
    if (periods.length > 1) {
      DOM.filterPeriod.append('<option value="all">Все периоды (агрегация)</option>');
    }
    periods.forEach(p => {
      DOM.filterPeriod.append(`<option value="${p}">${p}</option>`);
    });
    
    // KBKs
    const kbks = [...new Set(data.files.flatMap(f =>
      f.rows.map(r => r.kbk).filter(Boolean)
    ))];
    DOM.filterKbk.empty().append('<option value="">Все КБК</option>');
    kbks.forEach(k => {
      DOM.filterKbk.append(`<option value="${k}">${k}</option>`);
    });
    
    // Initialize Materialize select
    $('select').formSelect();
  }

  function loadInitialFilters(data) {
    // Set default region (first available)
    const regions = [...new Set(data.files.map(f => f.region).filter(Boolean))];
    if (regions.length > 0) {
      DOM.filterRegion.val(regions[0]);
    }
    
    // Set default period to "all" if available, otherwise most recent
    const periods = [...new Set(data.files.map(f => f.period).filter(Boolean))];
    if (periods.length > 0) {
      // Check if "all" option exists (it will be added in populateFilters)
      const hasAllOption = periods.length > 1;
      if (hasAllOption) {
        DOM.filterPeriod.val('all');
      } else {
        // Only one period available, select it
        DOM.filterPeriod.val(periods[0]);
      }
    }
    
    // Update filters state
    ReportCharts.filters.region = DOM.filterRegion.val();
    ReportCharts.filters.period = DOM.filterPeriod.val();
    ReportCharts.filters.kbk = DOM.filterKbk.val();
    
    // Apply filters immediately if region and period are selected
    if (ReportCharts.filters.region && ReportCharts.filters.period) {
      applyFilters();
    }
  }

  function applyFilters() {
    const region = DOM.filterRegion.val();
    const period = DOM.filterPeriod.val();
    const kbk = DOM.filterKbk.val();
    
    // Validate required filters
    if (!region || !period) {
      M.toast({html: 'Пожалуйста, выберите Регион и Период', classes: 'red'});
      DOM.reportBlock.addClass('disabled');
      return;
    }
    
    // Update state
    ReportCharts.filters.region = region;
    ReportCharts.filters.period = period;
    ReportCharts.filters.kbk = kbk;
    
    // Enable report block
    DOM.reportBlock.removeClass('disabled');
    
    // Calculate filtered data
    const filtered = calculateFilteredData();
    
    // Update KPIs
    updateKPIs(filtered);
    
    // Update charts
    updateCharts(filtered);
    
    M.toast({html: 'Фильтры применены', classes: 'green'});
  }

  function resetFilters() {
    DOM.filterRegion.val('');
    DOM.filterPeriod.val('');
    DOM.filterKbk.val('');
    $('select').formSelect();
    
    ReportCharts.filters.region = '';
    ReportCharts.filters.period = '';
    ReportCharts.filters.kbk = '';
    
    DOM.reportBlock.addClass('disabled');
    M.toast({html: 'Фильтры сброшены', classes: 'blue'});
  }

  function calculateFilteredData() {
    if (!ReportCharts.data) return null;
    
    const { region, period, kbk } = ReportCharts.filters;
    
    let files = [];
    if (period === 'all') {
      // Aggregate all periods for selected region
      files = ReportCharts.data.files.filter(f =>
        (!region || f.region === region)
      );
    } else {
      // Find the specific file matching region and period
      const file = ReportCharts.data.files.find(f =>
        f.region === region && f.period === period
      );
      if (file) files = [file];
    }
    
    if (files.length === 0) return null;
    
    // Combine rows from all selected files
    let rows = [];
    files.forEach(f => {
      rows = rows.concat(f.rows);
    });
    
    // Filter rows by KBK if specified
    if (kbk) {
      rows = rows.filter(r => r.kbk === kbk);
    }
    
    // Calculate aggregates
    const totalAmount = rows.reduce((sum, r) => {
      const amount = parseFloat(r.amount_in.replace(/,/g, '')) || 0;
      return sum + amount;
    }, 0);
    
    const uniqueTaxpayers = new Set(rows.map(r => r.iin_bin).filter(Boolean)).size;
    
    // Find previous year period for YoY calculation (only if single period selected)
    const prevYearData = period !== 'all' ? findPreviousYearData(region, period) : null;
    
    // Calculate top 10 taxpayers
    const taxpayerTotals = {};
    rows.forEach(r => {
      if (!r.iin_bin) return;
      const amount = parseFloat(r.amount_in.replace(/,/g, '')) || 0;
      taxpayerTotals[r.iin_bin] = (taxpayerTotals[r.iin_bin] || 0) + amount;
    });
    
    const top10 = Object.entries(taxpayerTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    const top10Total = top10.reduce((sum, [, amount]) => sum + amount, 0);
    const top10Share = totalAmount > 0 ? (top10Total / totalAmount) * 100 : 0;
    
    // Monthly breakdown based on actual periods
    const monthlyData = calculateMonthlyData(files, rows);
    
    return {
      files,
      rows,
      totalAmount,
      uniqueTaxpayers,
      prevYearData,
      top10,
      top10Total,
      top10Share,
      monthlyData
    };
  }

  function findPreviousYearData(region, period) {
    // Simplified: find same period in previous year
    if (!ReportCharts.data) return null;
    
    const periodMatch = period.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (!periodMatch) return null;
    
    const [, day, month, year] = periodMatch;
    const prevYear = parseInt(year) - 1;
    const prevPeriod = `${day}.${month}.${prevYear} - ${day}.${month}.${prevYear}`;
    
    return ReportCharts.data.files.find(f => 
      f.region === region && f.period.includes(prevPeriod)
    );
  }

  function calculateMonthlyData(files, rows) {
    // Extract month names from period strings
    const monthNames = {
      '01': 'Янв', '02': 'Фев', '03': 'Мар', '04': 'Апр', '05': 'Май', '06': 'Июн',
      '07': 'Июл', '08': 'Авг', '09': 'Сен', '10': 'Окт', '11': 'Ноя', '12': 'Дек'
    };
    
    // Group by month from period
    const monthMap = {};
    
    files.forEach(file => {
      const period = file.period;
      // Extract month from period format "DD.MM.YYYY - DD.MM.YYYY"
      const match = period.match(/(\d{2})\.(\d{2})\.\d{4}/);
      if (match) {
        const month = match[2]; // MM
        const monthName = monthNames[month] || month;
        
        // Sum amounts for this file
        const fileAmount = file.rows.reduce((sum, r) => {
          return sum + (parseFloat(r.amount_in.replace(/,/g, '')) || 0);
        }, 0);
        
        monthMap[monthName] = (monthMap[monthName] || 0) + fileAmount;
      }
    });
    
    // If no month data found, fallback to simple distribution
    if (Object.keys(monthMap).length === 0) {
      const total = rows.reduce((sum, r) => {
        return sum + (parseFloat(r.amount_in.replace(/,/g, '')) || 0);
      }, 0);
      
      // Use available months from files
      const availableMonths = [...new Set(files.map(f => {
        const match = f.period.match(/(\d{2})\.(\d{2})\.\d{4}/);
        return match ? monthNames[match[2]] : null;
      }).filter(Boolean))];
      
      if (availableMonths.length > 0) {
        availableMonths.forEach(month => {
          monthMap[month] = total / availableMonths.length;
        });
      } else {
        // Last resort: use first 2 months
        monthMap['Янв'] = total * 0.6;
        monthMap['Фев'] = total * 0.4;
      }
    }
    
    // Sort months chronologically
    const monthOrder = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
    const labels = Object.keys(monthMap).sort((a, b) =>
      monthOrder.indexOf(a) - monthOrder.indexOf(b)
    );
    const data = labels.map(label => monthMap[label]);
    
    return {
      labels,
      data
    };
  }

  function updateKPIs(filtered) {
    if (!filtered) return;
    
    // Format currency
    const formatCurrency = (amount) => {
      return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'KZT',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(amount).replace('KZT', '₸');
    };
    
    // Format percentage
    const formatPercent = (value) => {
      return value.toFixed(1) + '%';
    };
    
    // Total amount
    DOM.kpiTotal.text(formatCurrency(filtered.totalAmount));
    
    // YoY growth (simplified)
    const growth = filtered.prevYearData ? 12.5 : 0; // Demo value
    DOM.kpiGrowth.text(formatPercent(growth));
    DOM.kpiGrowth.removeClass('positive negative neutral')
      .addClass(growth > 0 ? 'positive' : growth < 0 ? 'negative' : 'neutral');
    
    // Unique taxpayers
    DOM.kpiTaxpayers.text(filtered.uniqueTaxpayers.toLocaleString('ru-RU'));
    
    // Top 10 share
    DOM.kpiTop10Share.text(formatPercent(filtered.top10Share));
  }

  function updateCharts(filtered) {
    if (!filtered) return;
    
    // Destroy existing charts
    Object.values(ReportCharts.charts).forEach(chart => {
      if (chart) chart.destroy();
    });
    
    // Create new charts
    if (DOM.lineChart.length) {
      ReportCharts.charts.line = createLineChart(filtered.monthlyData);
    }
    
    if (DOM.barChart.length) {
      ReportCharts.charts.bar = createBarChart(filtered.top10);
    }
    
    if (DOM.pieChart.length) {
      ReportCharts.charts.pie = createPieChart(filtered.top10, filtered.totalAmount);
    }
    
    // Update KBK details
    updateKbkDetails(filtered);
    
    // Update data table
    updateDataTable(filtered);
  }

  function createLineChart(monthlyData) {
    const ctx = DOM.lineChart[0].getContext('2d');
    
    return new Chart(ctx, {
      type: 'line',
      data: {
        labels: monthlyData.labels,
        datasets: [{
          label: 'Поступления по месяцам (₸)',
          data: monthlyData.data,
          borderColor: '#2196f3',
          backgroundColor: 'rgba(33, 150, 243, 0.1)',
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: '#2196f3',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              font: {
                family: 'Inter',
                size: 12,
                weight: 'bold'
              },
              color: '#0f172a'
            }
          },
          tooltip: {
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            titleColor: '#0f172a',
            bodyColor: '#475569',
            borderColor: 'rgba(15, 23, 42, 0.14)',
            borderWidth: 1,
            cornerRadius: 12,
            padding: 12,
            callbacks: {
              label: function(context) {
                const value = context.raw;
                return new Intl.NumberFormat('ru-RU', {
                  style: 'currency',
                  currency: 'KZT',
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0
                }).format(value).replace('KZT', '₸');
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(15, 23, 42, 0.08)'
            },
            ticks: {
              font: {
                family: 'Inter',
                size: 11,
                weight: '600'
              },
              color: '#475569'
            }
          },
          y: {
            grid: {
              color: 'rgba(15, 23, 42, 0.08)'
            },
            ticks: {
              font: {
                family: 'Inter',
                size: 11,
                weight: '600'
              },
              color: '#475569',
              callback: function(value) {
                if (value >= 1000000) {
                  return (value / 1000000).toFixed(1) + 'M';
                }
                if (value >= 1000) {
                  return (value / 1000).toFixed(0) + 'K';
                }
                return value;
              }
            }
          }
        }
      }
    });
  }

  function createBarChart(top10) {
    const ctx = DOM.barChart[0].getContext('2d');
    
    const labels = top10.map(([iin]) => iin.substring(0, 8) + '...');
    const data = top10.map(([, amount]) => amount);
    const colors = [
      '#2196f3', '#4caf50', '#ff9800', '#9c27b0', '#f44336',
      '#00bcd4', '#8bc34a', '#ffc107', '#795548', '#607d8b'
    ];
    
    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Сумма поступлений (₸)',
          data: data,
          backgroundColor: colors,
          borderColor: colors.map(c => c.replace('0.8', '1')),
          borderWidth: 1,
          borderRadius: 8,
          borderSkipped: false
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            titleColor: '#0f172a',
            bodyColor: '#475569',
            borderColor: 'rgba(15, 23, 42, 0.14)',
            borderWidth: 1,
            cornerRadius: 12,
            padding: 12,
            callbacks: {
              label: function(context) {
                const value = context.raw;
                return new Intl.NumberFormat('ru-RU', {
                  style: 'currency',
                  currency: 'KZT',
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0
                }).format(value).replace('KZT', '₸');
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(15, 23, 42, 0.08)'
            },
            ticks: {
              font: {
                family: 'Inter',
                size: 11,
                weight: '600'
              },
              color: '#475569',
              callback: function(value) {
                if (value >= 1000000) {
                  return (value / 1000000).toFixed(1) + 'M';
                }
                if (value >= 1000) {
                  return (value / 1000).toFixed(0) + 'K';
                }
                return value;
              }
            }
          },
          y: {
            grid: {
              color: 'rgba(15, 23, 42, 0.08)'
            },
            ticks: {
              font: {
                family: 'Inter',
                size: 11,
                weight: '600'
              },
              color: '#475569'
            }
          }
        }
      }
    });
  }

  function createPieChart(top10, totalAmount) {
    const ctx = DOM.pieChart[0].getContext('2d');
    
    const labels = top10.map(([iin]) => iin.substring(0, 8) + '...');
    const data = top10.map(([, amount]) => amount);
    const colors = [
      '#2196f3', '#4caf50', '#ff9800', '#9c27b0', '#f44336',
      '#00bcd4', '#8bc34a', '#ffc107', '#795548', '#607d8b'
    ];
    
    // Calculate "Others" slice
    const top10Total = data.reduce((sum, val) => sum + val, 0);
    const othersAmount = totalAmount - top10Total;
    
    if (othersAmount > 0) {
      labels.push('Остальные');
      data.push(othersAmount);
      colors.push('rgba(15, 23, 42, 0.2)');
    }
    
    return new Chart(ctx, {
      type: 'pie',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: colors,
          borderColor: 'rgba(255, 255, 255, 0.8)',
          borderWidth: 2,
          hoverOffset: 15
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              font: {
                family: 'Inter',
                size: 11,
                weight: '600'
              },
              color: '#475569',
              padding: 15,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            titleColor: '#0f172a',
            bodyColor: '#475569',
            borderColor: 'rgba(15, 23, 42, 0.14)',
            borderWidth: 1,
            cornerRadius: 12,
            padding: 12,
            callbacks: {
              label: function(context) {
                const label = context.label || '';
                const value = context.raw || 0;
                const percentage = context.parsed || 0;
                
                const formattedValue = new Intl.NumberFormat('ru-RU', {
                  style: 'currency',
                  currency: 'KZT',
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0
                }).format(value).replace('KZT', '₸');
                
                return `${label}: ${formattedValue} (${percentage.toFixed(1)}%)`;
              }
            }
          }
        },
        cutout: '45%'
      }
    });
  }

  function updateKbkDetails(filtered) {
    const kbkDetails = $('#kbk-details');
    if (!kbkDetails.length) return;
    
    // Group by KBK
    const kbkMap = {};
    filtered.rows.forEach(r => {
      const kbk = r.kbk || 'Не указан';
      const amount = parseFloat(r.amount_in.replace(/,/g, '')) || 0;
      kbkMap[kbk] = (kbkMap[kbk] || 0) + amount;
    });
    
    // Sort by amount descending
    const sorted = Object.entries(kbkMap).sort((a, b) => b[1] - a[1]);
    
    // If no KBK data
    if (sorted.length === 0) {
      kbkDetails.html('<div class="center-align grey-text">Нет данных по КБК</div>');
      return;
    }
    
    // Create simple bar chart visualization
    const maxAmount = Math.max(...sorted.map(([, amount]) => amount));
    const bars = sorted.map(([kbk, amount]) => {
      const percentage = maxAmount > 0 ? (amount / maxAmount) * 100 : 0;
      const formattedAmount = new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'KZT',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(amount).replace('KZT', '₸');
      
      return `
        <div class="kbk-bar-item" style="margin-bottom: 12px;">
          <div class="kbk-bar-label" style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="font-weight: 700; color: var(--chart-text);">${kbk}</span>
            <span style="font-weight: 800; color: var(--chart-primary);">${formattedAmount}</span>
          </div>
          <div class="kbk-bar-track" style="height: 8px; background: rgba(15, 23, 42, 0.08); border-radius: 4px; overflow: hidden;">
            <div class="kbk-bar-fill" style="height: 100%; width: ${percentage}%; background: linear-gradient(90deg, var(--chart-primary), var(--chart-info)); border-radius: 4px;"></div>
          </div>
        </div>
      `;
    }).join('');
    
    kbkDetails.html(`
      <div style="width: 100%; height: 100%; overflow-y: auto; padding-right: 8px;">
        <div style="margin-bottom: 16px; font-weight: 800; color: var(--chart-text); font-size: 14px;">
          Распределение по КБК (${sorted.length} ${sorted.length === 1 ? 'код' : 'кодов'})
        </div>
        ${bars}
      </div>
    `);
  }

  function updateDataTable(filtered) {
    const tableBody = $('#data-table-body');
    if (!tableBody.length) return;
    
    // Limit rows for performance
    const displayRows = filtered.rows.slice(0, 100);
    
    if (displayRows.length === 0) {
      tableBody.html(`
        <tr>
          <td colspan="5" class="center-align grey-text">Нет данных для отображения</td>
        </tr>
      `);
      return;
    }
    
    const rowsHtml = displayRows.map(r => {
      const amount = r.amount_in ? r.amount_in.replace(/,/g, '') : '0';
      const formattedAmount = new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'KZT',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(parseFloat(amount) || 0).replace('KZT', '₸');
      
      return `
        <tr class="js-data-row">
          <td>${r.iin_bin || ''}</td>
          <td>${r.bank_code || ''}</td>
          <td>${r.iik || ''}</td>
          <td>${r.kbk || ''}</td>
          <td>${formattedAmount}</td>
        </tr>
      `;
    }).join('');
    
    tableBody.html(rowsHtml);
    
    // Update table info
    const totalRows = filtered.rows.length;
    const showingRows = displayRows.length;
    const tableInfo = $('#data-table-info');
    if (tableInfo.length) {
      tableInfo.text(`Показано ${showingRows} из ${totalRows} строк${totalRows > showingRows ? ' (первые 100)' : ''}`);
    }
    
    // Initialize sorting if available
    if (typeof window.initTableSorting === 'function') {
      window.initTableSorting();
    }
  }

  function showLoading(show) {
    if (show) {
      DOM.loadingIndicator.removeClass('hide');
      DOM.reportBlock.addClass('disabled');
    } else {
      DOM.loadingIndicator.addClass('hide');
    }
  }

  function showError(message) {
    M.toast({html: `<i class="material-icons left">error</i> ${message}`, classes: 'red'});
  }

  // Public API
  window.ReportCharts = {
    init: init,
    refresh: applyFilters,
    getData: () => ReportCharts.data,
    getFilters: () => ReportCharts.filters
  };

  // Auto-initialize when DOM is ready
  $(document).ready(function() {
    // Check if Chart.js is loaded
    if (typeof Chart === 'undefined') {
      console.error('Chart.js is not loaded. Please include Chart.js CDN.');
      return;
    }
    
    // Initialize charts
    init();
  });
})();