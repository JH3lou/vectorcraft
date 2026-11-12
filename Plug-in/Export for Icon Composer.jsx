// Copyright (c) 2025-2026 Apple, Inc.  All rights reserved.
// Export for Icon Composer

var version = "2";
var ENV_PREFIX = "com.apple.ExportForIconComposer.";

function envKeyForDocument(doc) {
  var key = ENV_PREFIX + doc.name;
  try {
    if (doc.path && doc.path.fsName !== "") {
      key = ENV_PREFIX + doc.path.fsName + "/" + doc.name;
    }
  } catch (e) {}
  return key;
}

// Parse 1-based artboard ranges like "1, 3-5; 7" into 0-based indices
function parseArtboardRange(rangeStr, artboardCount) {
  if (!rangeStr || rangeStr.replace(/\s/g, "").length === 0) return null;

  var indices = [];
  var seen = {};
  var parts = rangeStr.split(/[,;]/);

  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].replace(/\s/g, "");
    if (part.length === 0) continue;

    var dashIdx = part.indexOf("-");
    if (dashIdx > 0) {
      var startStr = part.substring(0, dashIdx);
      var endStr = part.substring(dashIdx + 1);
      if (!/^\d+$/.test(startStr) || !/^\d+$/.test(endStr)) return null;
      var startNum = parseInt(startStr, 10);
      var endNum = parseInt(endStr, 10);
      if (
        startNum < 1 ||
        endNum < 1 ||
        startNum > artboardCount ||
        endNum > artboardCount
      )
        return null;
      if (startNum > endNum) return null;
      for (var n = startNum; n <= endNum; n++) {
        if (!seen[n - 1]) {
          indices.push(n - 1);
          seen[n - 1] = true;
        }
      }
    } else {
      if (!/^\d+$/.test(part)) return null;
      var num = parseInt(part, 10);
      if (num < 1 || num > artboardCount) return null;
      if (!seen[num - 1]) {
        indices.push(num - 1);
        seen[num - 1] = true;
      }
    }
  }

  if (indices.length === 0) return null;
  indices.sort(function (a, b) {
    return a - b;
  });
  return indices;
}

function getSafeFilesystemName(name) {
  // Replace illegal characters '/' and ':' with "_"
  var sanitizedName = name.replace(/[\/:]/g, "_");

  // Remove control characters
  sanitizedName = sanitizedName.replace(/[\x00-\x1F]/g, "");

  while (sanitizedName.length > 0 && sanitizedName.charAt(0) === ".") {
    sanitizedName = sanitizedName.substring(1);
  }

  // Strip leading/trailing whitespace
  sanitizedName = sanitizedName.replace(/^\s+|\s+$/g, "");

  if (sanitizedName.length === 0) {
    return "Untitled";
  }

  return sanitizedName;
}

// Illustrator's SVG exporter sanitizes `-` and non-ASCII differently in `id=`
// vs `xlink:href=`, breaking <use> references for clip masks. Replace both
// with an injective `_uNNNN_` escape. 'u' (not 'x') sidesteps Illustrator's
// own `_xNNNN_` escape. Injectivity matters because the inner mask id and
// the <use xlink:href> get the bare name with no auto-suffix — a many-to-one
// mapping would silently alias references in the output.
function getSafeXMLName(name) {
  if (!name) return name;
  var out = "";
  for (var i = 0; i < name.length; i++) {
    var cp = name.charCodeAt(i);
    if (cp === 0x2d || cp >= 0x80) {
      var hex = cp.toString(16).toUpperCase();
      while (hex.length < 4) hex = "0" + hex;
      out += "_u" + hex + "_";
    } else {
      out += name.charAt(i);
    }
  }
  return out;
}

function getExportFolder() {
  var folder = Folder.selectDialog("Choose a folder to export files");
  if (folder == null) {
    return null;
  }
  return folder;
}

function getISOTimeStamp(date) {
  date = date || new Date();
  var datePart = [
    date.getFullYear(),
    ("0" + (date.getMonth() + 1)).slice(-2),
    ("0" + date.getDate()).slice(-2),
  ].join("-");
  var timePart = [
    ("0" + date.getHours()).slice(-2),
    ("0" + date.getMinutes()).slice(-2),
    ("0" + date.getSeconds()).slice(-2),
  ].join(".");

  return datePart + " " + timePart;
}

function createContainerFolder(doc, customFolder) {
  if (!doc) {
    alert("Error: No document provided");
    return null;
  }

  var docPath;
  if (customFolder) {
    docPath = customFolder.fsName;
  } else {
    if (!doc.path || doc.path.fsName === "") {
      alert(
        "Error: The document must be saved before you can export files next to it.",
      );
      return null;
    }
    docPath = doc.path.fsName;
  }

  var docName = doc.name;
  var folderName = docName.replace(/\.[^.]+$/, ""); // Remove extension
  folderName = getSafeFilesystemName(folderName);

  var newFolderPath = docPath + "/" + folderName;

  var containerFolder = new Folder(newFolderPath);
  if (!containerFolder.exists) {
    if (!containerFolder.create()) {
      alert("Error: Failed to create folder: " + newFolderPath);
      return null;
    }
  } else {
    var timestamp = getISOTimeStamp();
    newFolderPath = docPath + "/" + folderName + " " + timestamp;
    containerFolder = new Folder(newFolderPath);

    if (!containerFolder.create()) {
      alert("Error: Failed to create folder: " + newFolderPath);
      return null;
    }
  }

  return containerFolder;
}

function getSVGOptions() {
  var options = new ExportOptionsSVG();
  options.embedRasterImages = true;
  options.coordinatePrecision = 7;
  options.fontSubsetting = SVGFontSubsetting.GLYPHSUSED;
  options.documentEncoding = SVGDocumentEncoding.UTF8;
  options.saveMultipleArtboards = false;
  return options;
}

function getPNGOptions() {
  var options = new ExportOptionsPNG24();
  options.antiAliasing = true;
  options.transparency = true;
  options.artBoardClipping = true;
  return options;
}

function createArtboardFolder(artboardName, exportFolder) {
  var safeArtboardName = getSafeFilesystemName(artboardName);
  var artboardFolder = new Folder(exportFolder.fsName + "/" + safeArtboardName);
  if (!artboardFolder.exists) {
    if (!artboardFolder.create()) {
      // Use the original artboard name in the error for user clarity.
      alert("Error: Could not create folder for artboard: " + artboardName);
      return null;
    }
  }
  return artboardFolder;
}

function itemOverlapsArtboard(item, artboardRect) {
  if (item.hidden) return false;
  var itemLeft = item.visibleBounds[0];
  var itemTop = item.visibleBounds[1];
  var itemRight = item.visibleBounds[2];
  var itemBottom = item.visibleBounds[3];

  var artboardLeft = artboardRect[0];
  var artboardTop = artboardRect[1];
  var artboardRight = artboardRect[2];
  var artboardBottom = artboardRect[3];

  return (
    itemLeft < artboardRight &&
    itemRight > artboardLeft &&
    itemTop > artboardBottom &&
    itemBottom < artboardTop
  );
}

function layerHasVisibleItemsInArtboard(layer, artboardRect) {
  // return true if the layer has any content overlapping with the artboard
  for (var i = layer.pageItems.length - 1; i >= 0; i--) {
    var item = layer.pageItems[i];
    if (itemOverlapsArtboard(item, artboardRect)) {
      return true;
    }
  }
  return false;
}

// pageItems doesn't recurse into GroupItem, so walk nested groups and
// compound paths explicitly.
function sanitizePageItemNames(container) {
  if (container.pageItems) {
    for (var i = 0; i < container.pageItems.length; i++) {
      var item = container.pageItems[i];
      if (item.name) item.name = getSafeXMLName(item.name);
      if (
        item.typename === "GroupItem" ||
        item.typename === "CompoundPathItem"
      ) {
        sanitizePageItemNames(item);
      }
    }
  }
  if (container.layers) {
    for (var j = 0; j < container.layers.length; j++) {
      sanitizePageItemNames(container.layers[j]);
    }
  }
}

function copyLayerToNewDocument(sourceLayer, artboardRect) {
  var width = artboardRect[2] - artboardRect[0];
  var height = artboardRect[1] - artboardRect[3];

  var newDoc = app.documents.add(DocumentColorSpace.RGB, width, height);
  newDoc.artboards[0].artboardRect = artboardRect;
  newDoc.layers[0].remove();

  var newLayer = newDoc.layers.add();
  newLayer.name = sourceLayer.name;

  for (var i = sourceLayer.pageItems.length - 1; i >= 0; i--) {
    var item = sourceLayer.pageItems[i];
    if (itemOverlapsArtboard(item, artboardRect)) {
      var dupe = item.duplicate(newLayer, ElementPlacement.INSIDE);
      dupe.position = item.position;
    }
  }

  sanitizePageItemNames(newLayer);

  return newDoc;
}

function processDocument(doc, format, customFolder, artboardIndices) {
  var exportFolder = createContainerFolder(doc, customFolder);

  if (exportFolder == null) {
    return;
  }

  var exportOptions;
  var exportFormat;

  if (format == "SVG") {
    exportOptions = getSVGOptions();
    exportFormat = ExportType.SVG;
  } else if (format == "PNG") {
    exportOptions = getPNGOptions();
    exportFormat = ExportType.PNG24;
  } else {
    alert("Unsupported format: " + format);
    return;
  }

  for (var i = 0; i < doc.artboards.length; i++) {
    if (artboardIndices && artboardIndices.length > 0) {
      var found = false;
      for (var ai = 0; ai < artboardIndices.length; ai++) {
        if (artboardIndices[ai] === i) {
          found = true;
          break;
        }
      }
      if (!found) continue;
    }
    doc.artboards.setActiveArtboardIndex(i);
    var artboard = doc.artboards[i];
    // when a new doc is created the active artboard changes
    // so fetch all necessary properties now
    var artboardRect = artboard.artboardRect;
    var artboardName = artboard.name;

    var useArtboardFolder = doc.artboards.length > 1;
    var artboardFolder = null;
    var exportPath = exportFolder.fsName;

    var layersExported = 0;
    var totalLayers = 0;
    for (var j = 0; j < doc.layers.length; j++) {
      var layer = doc.layers[j];

      if (
        layer.visible &&
        layerHasVisibleItemsInArtboard(layer, artboardRect)
      ) {
        totalLayers++;
      }
    }

    for (var j = 0; j < doc.layers.length; j++) {
      var layer = doc.layers[j];

      if (
        layer.visible &&
        layerHasVisibleItemsInArtboard(layer, artboardRect)
      ) {
        if (useArtboardFolder) {
          if (artboardFolder === null) {
            artboardFolder = createArtboardFolder(artboardName, exportFolder);
            if (artboardFolder === null) {
              break;
            }
          }
          exportPath = artboardFolder.fsName;
        }

        var tempDoc = copyLayerToNewDocument(layer, artboardRect);

        var layerNumber = totalLayers - layersExported;

        var fileName = (
          layerNumber +
          "." +
          getSafeFilesystemName(layer.name) +
          "." +
          format
        ).toLowerCase();

        var file = new File(exportPath + "/" + fileName);
        tempDoc.exportFile(file, exportFormat, exportOptions);
        tempDoc.close(SaveOptions.DONOTSAVECHANGES);
        layersExported++;
      }
    }
  }
}

function batchProcessFiles(format, customFolder) {
  var aiFileFilter_macOS = function (f) {
    if (f instanceof Folder) return true;
    return /\.ai$/i.test(f.name);
  };

  var inputFiles = File.openDialog(
    "Select one or more Illustrator files",
    aiFileFilter_macOS,
    true,
  );

  if (inputFiles != null) {
    for (var i = 0; i < inputFiles.length; i++) {
      var doc = app.open(inputFiles[i]);
      processDocument(doc, format, customFolder);
      doc.close(SaveOptions.DONOTSAVECHANGES);
    }
    alert("Processed " + inputFiles.length + " files");
  }
}

function showExportDialog() {
  var dialog = new Window("dialog", "Export for Icon Composer");
  dialog.alignChildren = "left"; // Align all children to the left

  // Main options group to contain processing options and format side by side
  var mainOptionsGroup = dialog.add("group");
  mainOptionsGroup.orientation = "row";
  mainOptionsGroup.alignChildren = "top";

  // File input choice
  var inputGroup = mainOptionsGroup.add(
    "panel",
    undefined,
    "Processing Options",
  );
  inputGroup.orientation = "column";
  inputGroup.alignChildren = "left";

  var currentDocRadio = inputGroup.add(
    "radiobutton",
    undefined,
    "Process Current Document",
  );
  var batchRadio = inputGroup.add(
    "radiobutton",
    undefined,
    "Batch Process Files",
  );

  currentDocRadio.onClick = function () {
    if (artboardPanel) artboardPanel.enabled = true;
    validateExportButton();
  };

  batchRadio.onClick = function () {
    if (artboardPanel) artboardPanel.enabled = false;
    validateExportButton();
  };

  // Format choice
  var formatPanel = mainOptionsGroup.add("panel", undefined, "Export Format");
  formatPanel.orientation = "column";
  formatPanel.alignChildren = "left";
  formatPanel.preferredSize.height = 78;

  var format = "SVG";
  var formatNames = ["SVG", "PNG"];

  dialog.formatList = formatPanel.add("dropdownlist", undefined, formatNames);
  dialog.formatList.selection = 0;
  dialog.formatList.preferredSize.width = 123;

  // Export location options
  var locationGroup = dialog.add("panel", undefined, "Export Location");
  locationGroup.orientation = "column";
  locationGroup.alignChildren = "left";

  var nextToRadio = locationGroup.add(
    "radiobutton",
    undefined,
    "Next to document",
  );
  var customFolderRadio = locationGroup.add(
    "radiobutton",
    undefined,
    "Custom export folder",
  );

  // Folder path and browse button
  var folderGroup = locationGroup.add("group");
  folderGroup.orientation = "row";
  folderGroup.alignment = "fill";

  var outputFolderText = folderGroup.add("edittext", undefined, "");
  outputFolderText.preferredSize.width = 250;
  outputFolderText.enabled = false;

  var browseButton = folderGroup.add("button", undefined, "Browse\u2026");
  browseButton.enabled = false;

  var selectedFolder = null;

  // Default to "Next to document" option
  nextToRadio.value = true;

  function validateExportButton() {
    if (!exportButton) return;
    if (customFolderRadio.value) {
      var isValidPath = false;

      if (selectedFolder && selectedFolder.exists) {
        isValidPath = true;
      } else if (outputFolderText.text != "") {
        var testFolder = new Folder(outputFolderText.text);
        isValidPath = testFolder.exists;
      }

      if (!isValidPath) {
        exportButton.enabled = false;
        return;
      }
    }

    if (
      currentDocRadio.value &&
      artboardList &&
      rangeRadio &&
      rangeRadio.value
    ) {
      var parsed = parseArtboardRange(
        rangeInput.text,
        app.activeDocument.artboards.length,
      );
      if (!parsed) {
        exportButton.enabled = false;
        return;
      }
    } else if (
      currentDocRadio.value &&
      artboardList &&
      (!artboardList.selection || artboardList.selection.length === 0)
    ) {
      exportButton.enabled = false;
      return;
    }

    exportButton.enabled = true;
  }

  nextToRadio.onClick = function () {
    outputFolderText.enabled = false;
    browseButton.enabled = false;
    validateExportButton();
  };

  customFolderRadio.onClick = function () {
    outputFolderText.enabled = true;
    browseButton.enabled = true;
    validateExportButton();
  };

  outputFolderText.onChanging = function () {
    selectedFolder = new Folder(outputFolderText.text);
    validateExportButton();
  };

  browseButton.onClick = function () {
    var folder = getExportFolder();
    if (folder != null) {
      selectedFolder = folder;
      outputFolderText.text = folder.fsName;
      validateExportButton();
    }
  };

  // Artboard selection panel (only for multi-artboard documents)
  var artboardPanel = null;
  var artboardList = null;
  var selectAllBtn = null;
  var deselectAllBtn = null;
  var selectArtboardsRadio = null;
  var rangeRadio = null;
  var rangeInput = null;
  var RANGE_PREFIX = "range:";
  var SELECT_PREFIX = "select:";

  if (app.documents.length > 0 && app.activeDocument.artboards.length > 1) {
    artboardPanel = dialog.add("panel", undefined, "Artboards");
    artboardPanel.orientation = "column";
    artboardPanel.alignChildren = "fill";

    selectArtboardsRadio = artboardPanel.add(
      "radiobutton",
      undefined,
      "Select Artboards",
    );

    artboardList = artboardPanel.add("listbox", undefined, [], {
      multiselect: true,
    });
    artboardList.preferredSize = [340, 120];

    var artboards = app.activeDocument.artboards;
    for (var ab = 0; ab < artboards.length; ab++) {
      artboardList.add("item", artboards[ab].name);
    }

    var selectAllArtboards = function () {
      for (var s = 0; s < artboardList.items.length; s++) {
        artboardList.items[s].selected = true;
      }
    };

    var abButtonGroup = artboardPanel.add("group");
    abButtonGroup.orientation = "row";
    abButtonGroup.alignment = "left";
    selectAllBtn = abButtonGroup.add("button", undefined, "Select All");
    deselectAllBtn = abButtonGroup.add("button", undefined, "Deselect All");

    selectAllBtn.onClick = function () {
      selectAllArtboards();
      validateExportButton();
    };

    deselectAllBtn.onClick = function () {
      artboardList.selection = null;
      validateExportButton();
    };

    artboardList.onChange = function () {
      validateExportButton();
    };

    rangeRadio = artboardPanel.add("radiobutton", undefined, "Range:");
    rangeInput = artboardPanel.add("edittext", undefined, "");
    rangeInput.preferredSize.width = 200;
    rangeInput.enabled = false;

    var setSelectMode = function () {
      selectArtboardsRadio.value = true;
      rangeRadio.value = false;
      artboardList.enabled = true;
      selectAllBtn.enabled = true;
      deselectAllBtn.enabled = true;
      rangeInput.enabled = false;
      validateExportButton();
    };

    var setRangeMode = function () {
      rangeRadio.value = true;
      selectArtboardsRadio.value = false;
      artboardList.enabled = false;
      selectAllBtn.enabled = false;
      deselectAllBtn.enabled = false;
      rangeInput.enabled = true;
      validateExportButton();
    };

    selectArtboardsRadio.onClick = setSelectMode;
    rangeRadio.onClick = setRangeMode;

    rangeInput.onChanging = function () {
      validateExportButton();
    };

    // Restore previous selection from session, or select all by default
    var restored = false;
    try {
      var savedKey = envKeyForDocument(app.activeDocument);
      var savedVal = $.getenv(savedKey);
      if (savedVal && savedVal.length > 0) {
        if (savedVal.substring(0, RANGE_PREFIX.length) === RANGE_PREFIX) {
          rangeInput.text = savedVal.substring(RANGE_PREFIX.length);
          selectAllArtboards();
          setRangeMode();
          restored = true;
        } else if (
          savedVal.substring(0, SELECT_PREFIX.length) === SELECT_PREFIX
        ) {
          var parts = savedVal.substring(SELECT_PREFIX.length).split(",");
          var validIndices = [];
          for (var ri = 0; ri < parts.length; ri++) {
            var idx = parseInt(parts[ri], 10);
            if (!isNaN(idx) && idx >= 0 && idx < artboardList.items.length) {
              validIndices.push(idx);
            }
          }
          if (validIndices.length > 0) {
            for (var vi = 0; vi < validIndices.length; vi++) {
              artboardList.items[validIndices[vi]].selected = true;
            }
            setSelectMode();
            restored = true;
          }
        }
      }
    } catch (e) {}

    if (!restored) {
      selectAllArtboards();
      setSelectMode();
    }
  }

  // Dialog main buttons
  var mainButtonGroup = dialog.add("group");
  mainButtonGroup.orientation = "row";
  mainButtonGroup.alignment = "right";
  var cancelButton = mainButtonGroup.add("button", undefined, "Cancel");
  var exportButton = mainButtonGroup.add("button", undefined, "Export");

  if (app.documents.length > 0) {
    currentDocRadio.value = true;
  } else {
    batchRadio.value = true;
    currentDocRadio.enabled = false;
    if (artboardPanel) artboardPanel.enabled = false;
  }
  nextToRadio.value = true; // Default to next to document

  cancelButton.onClick = function () {
    dialog.close();
  };

  exportButton.onClick = function () {
    dialog.close();

    format = formatNames[dialog.formatList.selection.index];
    var customFolder = null;

    if (customFolderRadio.value) {
      customFolder = selectedFolder;
    }

    if (currentDocRadio.value) {
      var artboardIndices = null;
      if (artboardList && rangeRadio && rangeRadio.value) {
        artboardIndices = parseArtboardRange(
          rangeInput.text,
          app.activeDocument.artboards.length,
        );
        try {
          $.setenv(
            envKeyForDocument(app.activeDocument),
            RANGE_PREFIX + rangeInput.text,
          );
        } catch (e) {}
      } else if (artboardList && artboardList.selection) {
        artboardIndices = [];
        for (var si = 0; si < artboardList.selection.length; si++) {
          artboardIndices.push(artboardList.selection[si].index);
        }
        try {
          $.setenv(
            envKeyForDocument(app.activeDocument),
            SELECT_PREFIX + artboardIndices.join(","),
          );
        } catch (e) {}
      }
      processDocument(
        app.activeDocument,
        format,
        customFolder,
        artboardIndices,
      );
    } else {
      batchProcessFiles(format, customFolder);
    }
  };

  validateExportButton();

  exportButton.active = true;
  dialog.defaultElement = exportButton;
  dialog.show();
}

showExportDialog();
