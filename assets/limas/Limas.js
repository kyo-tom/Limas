Ext.namespace('Limas');

Limas.application = null;

Ext.application({
	name: 'Limas',
	init: function () {
	},
	launch: function (/*profile*/) {
		Ext.setGlyphFontFamily('FontAwesome');
		Ext.get('loader-wrapper').hide();
		Ext.setLocale('sk_SK');

		this.createLayout();

		Limas.application = this;

		Limas.setMaxUploadSize(window.parameters.maxUploadSize);
		Limas.setAvailableImageFormats(window.parameters.availableImageFormats);
		Limas.setOctoPartAvailable(window.parameters.isOctoPartAvailable);

		Limas.Auth.AuthenticationProvider.setAuthenticationProvider(Ext.create('Limas.Auth.' + window.parameters.authentication_provider + 'AuthenticationProvider'));

		this.control({
			'MenuBar menuitem': {
				click: this.onAppMenuClick,
				scope: this
			}
		});

		let config = {};
		if (window.parameters.autoLoginUsername) {
			config.autoLogin = true;
			config.autoLoginUsername = window.parameters.autoLoginUsername;
			config.autoLoginPassword = window.parameters.autoLoginPassword;
		}

		this.loginManager = Ext.create('Limas.Auth.LoginManager', config);
		this.loginManager.on('login', this.onLogin, this);
		this.loginManager.on('logout', this.onLogout, this);
		this.loginManager.login();
	},
	onAppMenuClick: function (item) {
		if (typeof item.target === 'function') {
			this.openAppItem(item.target['$className']);
		}
		if (typeof (item.theme) === 'string') {
			this.switchTheme(item.theme);
		}
	},
	openAppItem: function (target) {
		let targetClass = Ext.ClassManager.get(target),
			j = Ext.create(target, {
				title: targetClass.title,
				closable: targetClass.closable,
				iconCls: targetClass.iconCls
			});

		if (targetClass.superclass['$className'] === 'Limas.Actions.BaseAction') {
			j.execute();
		} else {
			Limas.getApplication().addItem(j);
			j.show();
		}
	},
	getParameter: function (parameter) {
		if (window.parameters[parameter] !== undefined) {
			return window.parameters[parameter];
		}
	},
	getLoginManager: function () {
		return this.loginManager;
	},
	getPartManager: function () {
		return this.partManager;
	},
	/**
	 * Handles the login function. Initializes the part manager window, enables the menu bar and creates the stores+loads them.
	 */
	onLogin: function () {
		this.createGlobalStores();

		let reader = this.getUserPreferenceStore().getProxy().getReader();
		this.getUserPreferenceStore().loadRecords(reader.read(Ext.decode(this.getLoginManager().getUser().get('initialUserPreferences')), {
			recordCreator: reader.defaultRecordCreatorFromServer // force server version (fantom=false)
		}).records);

		let preferredTheme = this.getUserPreference('limas.user.theme', null);

		this.createPartManager();

		this.menuBar.enable();

		this.doSystemStatusCheck();

		this.unacknowledgedNoticesTask = Ext.TaskManager.start({
			run: this.doUnacknowledgedNoticesCheck,
			scope: this,
			interval: 100000
		});

		this.displayTipWindowTask = new Ext.util.DelayedTask(this.displayTipOfTheDayWindow, this);
		this.displayTipWindowTask.delay(100);

		if (window.parameters.motd) {
			this.displayMOTD();
		}

		this.getStatusbar().setConnected();

		if (preferredTheme !== null && preferredTheme !== window.theme) {
			this.switchTheme(preferredTheme);
		}
	},
	onLogout: function () {
		this.menuBar.disable();
		this.centerPanel.removeAll(true);
		this.getStatusbar().setDisconnected();

		Ext.TaskManager.stop(this.unacknowledgedNoticesTask);
	},
	/**
	 * Re-creates the part manager. This is usually called when the "compactLayout" configuration option has been
	 * changed.
	 */
	recreatePartManager: function () {
		this.centerPanel.remove(this.partManager);
		this.getPartManager().destroy();
		this.createPartManager();
	},
	/**
	 * Creates the part manager. While this is usually only done after login, it can also happen when the user changes
	 * the "compact" preference.
	 */
	createPartManager: function () {
		this.partManager = Ext.create('Limas.PartManager', {
			title: i18n('Part Manager'),
			compactLayout: Limas.getApplication().getUserPreference('limas.partmanager.compactlayout', false),
			iconCls: 'web-icon brick',
			closable: false
		});

		this.centerPanel.insert(0, this.partManager);
	},
	/**
	 * Sets the initial user preferences, which are applied into the userPreferenceStore after login
	 */
	setInitialUserPreferences: function (obj) {
		Limas.initialUserPreferences = obj;
	},
	/**
	 * Displays the tip of the day window.
	 *
	 * This method checks if the user has disabled tips, and if so, this method avoids showing the window.
	 */
	displayTipOfTheDayWindow: function () {
		if (!Ext.data.StoreManager.lookup('TipOfTheDayStore')
			|| !Ext.data.StoreManager.lookup('TipOfTheDayStore').isLoaded()
			|| !Ext.data.StoreManager.lookup('TipOfTheDayHistoryStore')
			|| !Ext.data.StoreManager.lookup('TipOfTheDayHistoryStore').isLoaded()
			|| !this.getUserPreferenceStore().isLoaded()
		) {
			this.displayTipWindowTask.delay(100);
			return;
		}

		if (Limas.getApplication().getUserPreference('limas.tipoftheday.showtips') !== false) {
			let j = Ext.create('Limas.TipOfTheDayWindow');
			if (j.hasTips()) {
				j.show();
			}
		}
	},
	/**
	 * Displays a message-of-the-day
	 */
	displayMOTD: function () {
		Ext.MessageBox.alert(i18n('Message of the day'), window.parameters.motd);
	},
	/**
	 * Does a schema status call against the Limas installation, in order to verify if the schema is up-to-date
	 */
	doSystemStatusCheck: function () {
		let call = new Limas.ServiceCall('api', 'system_status');
		call.setHandler(Ext.bind(this.onSystemStatusCheck, this));
		call.doCall();
	},
	/**
	 * Handler for the schema check
	 * @param data The data returned from the server
	 */
	onSystemStatusCheck: function (data) {
		if (data.schemaStatus !== 'complete') {
			alert(i18n('Your database schema is not up-to-date! Please re-run setup immediately!'));
		}
		if (data.inactiveCronjobCount > 0) {
			alert(i18n("The following cronjobs aren't running:") + '\n\n' + data.inactiveCronjobs.join('\n'));
		}
	},
	/*
	 * Checks for unacknowledged system notices. Triggers a service call against the server.
	 *
	 * Checks if a session is active; otherwise, nothing will happen
	 */
	doUnacknowledgedNoticesCheck: function () {
		this.systemNoticeStore.load({
			scope: this,
			callback: this.onUnacknowledgedNoticesCheck
		});
	},
	/**
	 * Handler for the unacknowledged system notices check
	 * @param data The data returned from the server
	 */
	onUnacknowledgedNoticesCheck: function () {
		if (this.systemNoticeStore.count() > 0) {
			this.statusBar.systemNoticeButton.show();
		} else {
			this.statusBar.systemNoticeButton.hide();
		}
	},
	createGlobalStores: function () {
		this.footprintStore = Ext.create('Ext.data.Store', {
			model: 'Limas.Entity.Footprint',
			pageSize: 99999999,
			autoLoad: true
		});
		this.siPrefixStore = Ext.create('Ext.data.Store', {
			model: 'Limas.Entity.SiPrefix',
			pageSize: 99999999,
			autoLoad: true
		});
		this.currencyStore = Ext.create('Limas.Data.Store.CurrencyStore', {
			autoLoad: true
		});
		this.distributorStore = Ext.create('Ext.data.Store', {
			model: 'Limas.Entity.Distributor',
			pageSize: 99999999,
			autoLoad: true
		});
		this.manufacturerStore = Ext.create('Ext.data.Store', {
			model: 'Limas.Entity.Manufacturer',
			pageSize: 99999999,
			autoLoad: true
		});
		this.partUnitStore = Ext.create('Ext.data.Store', {
			model: 'Limas.Entity.PartMeasurementUnit',
			pageSize: 99999999,
			autoLoad: true
		});
		this.userProviderStore = Ext.create('Ext.data.Store', {
			model: 'Limas.Entity.UserProvider',
			pageSize: 99999999,
			autoLoad: true
		});
		this.unitStore = Ext.create('Ext.data.Store', {
			model: 'Limas.Entity.Unit',
			pageSize: 99999999,
			autoLoad: true
		});
		this.userStore = Ext.create('Ext.data.Store', {
			model: 'Limas.Entity.User',
			pageSize: 99999999,
			autoLoad: true
		});
		this.userPreferenceStore = Ext.create('Limas.Data.store.UserPreferenceStore', {
			model: 'Limas.Entity.UserPreference',
			autoLoad: false
		});
		this.barcodeScannerManager = Ext.create('Limas.BarcodeScanner.Manager');
		this.systemPreferenceStore = Ext.create('Limas.Data.store.SystemPreferenceStore', {
			model: 'Limas.Entity.SystemPreference',
			autoLoad: true,
			listeners: {
				scope: this,
				'load': function () {
					this.barcodeScannerManager.registerBarcodeScannerHotkey();
				}
			}
		});

		this.tipOfTheDayStore = Ext.create('Limas.Data.store.TipOfTheDayStore');
		this.tipOfTheDayHistoryStore = Ext.create('Limas.Data.store.TipOfTheDayHistoryStore');
		this.systemNoticeStore = Ext.create('Limas.Data.store.SystemNoticeStore');
	},
	getBarcodeScannerManager: function () {
		return this.barcodeScannerManager;
	},
	storeLoaded: function (store) {
		store._loaded = true;
	},
	getSystemPreferenceStore: function () {
		return this.systemPreferenceStore;
	},
	/**
	 * Queries for a specific system preference. Returns either the value or a default value if
	 * the preference was not found.
	 * @param key The key to query
	 * @param defaultValue A default value to return (optional)
	 * @returns the key value, or defaultValue if preference key was not found
	 */
	getSystemPreference: function (key, defaultValue) {
		if (this.systemPreferenceStore === undefined) {
			return defaultValue;
		}
		let record = this.systemPreferenceStore.findRecord('preferenceKey', key);

		if (record) {
			let value = record.get('preferenceValue'),
				decodedValue = Ext.decode(value, true);
			if (decodedValue === null) {
				return value;
			}
			return decodedValue;
		}
		return (typeof defaultValue == 'undefined') ? null : defaultValue;
	},
	/**
	 * Sets a specific system preference. Directly commits the change to the server.
	 *
	 * @param key The key to set
	 * @param value The value to set
	 */
	setSystemPreference: function (key, value) {
		let record = this.systemPreferenceStore.findRecord('preferenceKey', key);
		value = Ext.encode(value);

		if (record) {
			if (record.get('preferenceValue') != value) {
				record.set('preferenceValue', value);
				record.save();
			}
		} else {
			let j = new Limas.Entity.SystemPreference();
			j.set('preferenceKey', key);
			j.set('preferenceValue', value);
			j.save();
			this.systemPreferenceStore.add(j);
		}
	},
	/**
	 * Queries for a specific user preference. Returns either the value or a default value if the preference was not found
	 * @param key The key to query
	 * @param defaultValue A default value to return (optional)
	 * @returns the key value, or defaultValue if preference key was not found
	 */
	getUserPreference: function (key, defaultValue) {
		let record = this.userPreferenceStore.findRecord('preferenceKey', key);
		if (record) {
			let value = record.get('preferenceValue');
			let decodedValue = Ext.decode(value, true);
			if (decodedValue === null) {
				return value;
			}
			return decodedValue;
		}
		return (typeof defaultValue == 'undefined') ? null : defaultValue;
	},
	/**
	 * Sets a specific user preference. Directly commits the change to the server.
	 *
	 * @param key The key to set
	 * @param value The value to set
	 */
	setUserPreference: function (key, value) {
		let record = this.userPreferenceStore.findRecord('preferenceKey', key);
		value = Ext.encode(value);

		if (record) {
			if (record.get('preferenceValue') != value) {
				record.set('preferenceValue', value);
				record.save();
			}
		} else {
			let j = new Limas.Entity.UserPreference();
			j.set('preferenceKey', key);
			j.set('preferenceValue', value);
			j.save();
			this.userPreferenceStore.add(j);
		}
	},
	getUserPreferenceStore: function () {
		return this.userPreferenceStore;
	},
	getUnitStore: function () {
		return this.unitStore;
	},
	getPartUnitStore: function () {
		return this.partUnitStore;
	},
	getUserProviderStore: function () {
		return this.userProviderStore;
	},
	getFootprintStore: function () {
		return this.footprintStore;
	},
	getManufacturerStore: function () {
		return this.manufacturerStore;
	},
	getDistributorStore: function () {
		return this.distributorStore;
	},
	getCurrencyStore: function () {
		return this.currencyStore;
	},
	getDefaultPartUnit: function () {
		return this.partUnitStore.findRecord('default', true);
	},
	getUserStore: function () {
		return this.userStore;
	},
	getSiPrefixStore: function () {
		return this.siPrefixStore;
	},
	uploadFileFromURL: function (url, description, callback, scope) {
		Ext.Ajax.request({
			url: Limas.getBasePath() + '/api/temp_uploaded_files/upload',
			method: 'POST',
			params: {
				description: description,
				url: url
			},
			callback: callback,
			scope: scope
		});
	},
	/**
	 * Converts the Character "micro" (µ, available on german keyboards via AltGr+m) to the Character "Mu" (μ)
	 * The standard for Si-Prefixes defines that the "Mu"-character should be used instead of the "micro" character
	 * Wikipedia Entry for the "Micro" Si Prefix: http://en.wikipedia.org/wiki/Micro-
	 */
	convertMicroToMu: function (value) {
		/**
		 * Since the Si-Prefix for "micro" is μ, but keyboard have "µ" on it
		 * (note: both chars might look identical, depending on your font), we need to convert "µ" (on the keyboard,
		 * Unicode U+00B5) to the Mu (U+03BC).
		 */
		return str_replace('µ', 'μ', value);
	},
	createLayout: function () {
		this.statusBar = Ext.create('Limas.Statusbar');
		this.messageLog = this.createMessageLog();
		this.centerPanel = Ext.create('Ext.tab.Panel', {
			xtype: 'tabpanel',
			border: false,
			region: 'center',
			bodyStyle: 'background:#DBDBDB',
			plugins: [
				Ext.create('Ext.ux.TabCloseMenu'),
				Ext.create('Ext.ux.TabCloseOnMiddleClick')
			]
		});
		this.menuBar = Ext.create('Limas.MenuBar');
		this.menuBar.disable();
		this.viewPort = Ext.create('Ext.container.Viewport', {
			layout: 'fit',
			items: [
				{
					xtype: 'panel',
					border: false,
					layout: 'border',
					items: [
						this.centerPanel,
						this.messageLog
					],
					bbar: this.statusBar,
					tbar: this.menuBar
				}
			]
		});
	},
	addItem: function (item) {
		this.centerPanel.add(item);
	},
	createMessageLog: function () {
		return Ext.create('Limas.MessageLog', {
			height: 200,
			hidden: true,
			split: true,
			title: i18n('Message Log'),
			titleCollapse: true,
			collapsible: true,
			region: 'south',
			listeners: {
				beforecollapse: Ext.bind(
					function () {
						this.hideMessageLog();
						return false;
					},
					this)
			}
		});
	},
	hideMessageLog: function () {
		this.messageLog.hide();
	},
	showMessageLog: function () {
		this.messageLog.show();
	},
	toggleMessageLog: function () {
		if (this.messageLog.isHidden()) {
			this.showMessageLog();
		} else {
			this.hideMessageLog();
		}
	},
	getStatusbar: function () {
		return this.statusBar;
	},
	/**
	 * Sets the username. This should only be called from the login dialog.
	 *
	 * Also updates the statusbar to reflect the username.
	 *
	 * @param {string} username The username to set
	 */
	setUsername: function (username) {
		this.username = username;
		this.getStatusbar().setCurrentUser(username);
	},
	/**
	 * Returns the current username
	 * @returns {string}
	 */
	getUsername: function () {
		return this.username;
	},
	formatCurrency: function (value, code) {
		let format = Ext.util.Format;
		format.currencyPrecision = Limas.getApplication().getUserPreference('limas.formatting.currency.numdecimals', 2);
		format.currencySign = Limas.getApplication().getUserPreference('limas.formatting.currency.symbol', '€');

		if (code !== null) {
			let currency = Limas.getApplication().getCurrencyStore().findRecord('code', code, 0, false, false, true);
			if (currency !== null) {
				format.currencySign = currency.get('symbol');
			}
		}

		format.currencyAtEnd = Limas.getApplication().getUserPreference('limas.formatting.currency.currencySymbolAtEnd', true);

		if (Limas.getApplication().getUserPreference('limas.formatting.currency.thousandsSeparator', true) === true) {
			// @todo This is hard-coded for now
			format.thousandSeparator = ',';
		} else {
			format.thousandSeparator = '';
		}

		return format.currency(value);
	},
	switchTheme: function (theme) {
		if (window.themes[theme]) {
			window.theme = theme;
			this.setUserPreference('limas.user.theme', theme);
			this.menuBar.selectTheme(theme);
			Ext.util.CSS.swapStyleSheet('theme', window.themes[theme].themeUri);
			Ext.util.CSS.swapStyleSheet('themeUx', window.themes[theme].themeUxUri);

			Ext.get('loader-wrapper').show();
			Ext.get('loader-message').setHtml(i18n('Applying theme…'));

			Ext.defer(this.updateThemeLayout, 1000, this);
		}
	},
	updateThemeLayout: function () {
		Ext.get('loader-wrapper').hide();

		Ext.defer(this.refreshLayout, 100, this);
	},
	refreshLayout: function () {
		this.viewPort.updateLayout();
	}
});

Limas.getSession = function () {
	alert('This should not be called.');
	return 'hli2ong0ktnise68p9f5nu6nk1';
};

/**
 * <p>This static method returns the instance of the application.</p>
 * @return {Limas} The application
 */
Limas.getApplication = function () {
	return Limas.application;
};

Limas.getBasePath = function () {
	let href = document.getElementsByTagName('base')[0].href;
	if (/\/\/$/.test(href)) {
		return href.substring(0, href.length - 2);
	}
	if (/\/$/.test(href)) {
		return href.substring(0, href.length - 1);
	}
	return href;
};

Limas.setMaxUploadSize = function (size) {
	Limas.maxUploadSize = size;
};

Limas.getMaxUploadSize = function () {
	return Limas.maxUploadSize;
};

Limas.setOctoPartAvailable = function (octoPartAvailable) {
	Limas.octoPartAvailable = octoPartAvailable;
};

Limas.isOctoPartAvailable = function () {
	return Limas.octoPartAvailable;
};

Limas.bytesToSize = function (bytes) {
	if (bytes === 0) {
		return '0 Bytes';
	}
	let sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'],
		i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)), 10);
	return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
};

Limas.setAvailableImageFormats = function (formats) {
	Limas.imageFormats = formats;
};

Limas.getAvailableImageFormats = function () {
	return Limas.imageFormats;
};

Limas.serializeRecords = function (records) {
	let finalData = [];
	for (let i = 0; i < records.length; i++) {
		finalData.push(records[i].data);
	}
	return finalData;
};
