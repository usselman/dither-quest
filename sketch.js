let img;
let ditheredImg; // Off-screen graphics buffer for dithering
let resInput; // Updated to use input boxes
let canvas;

function setup() {
    canvas = createCanvas(600, 480, WEBGL);
    canvas.center('horizontal');
    background(220);

    const controlsDiv = createDiv('');
    controlsDiv.id('controls');
    controlsDiv.style('flex', 'justify-between', 'center');
    controlsDiv.position(canvas.x, windowHeight - 180);

    createLabelAndInput(controlsDiv, 'Resolution (1-150):', 5, () => {
        if (img && ditheredImg) ellipseDitherImage();
    });

    input = createFileInput(handleFile);
    input.parent(controlsDiv);

    button = createButton('Download');
    button.parent(controlsDiv);
    button.mousePressed(downloadImage);

    noLoop();
}

function draw() {
    // Now only redraws when explicitly called
}

function handleFile(file) {
    if (file.type === 'image') {
        img = loadImage(file.data, () => {
            ditheredImg = createGraphics(img.width, img.height);
            ellipseDitherImage();
        });
    }
}

function createLabelAndInput(parentDiv, labelText, defaultValue, inputCallback) {
    let label = createElement('label', labelText);
    label.parent(parentDiv);

    let input = createInput(defaultValue.toString(), 'number');
    input.parent(parentDiv);
    input.input(inputCallback);

    // Assign the input to the appropriate global variable
    if (labelText.startsWith('Resolution')) {
        resInput = input; // Make sure this is declared globally
    }
}

function ellipseDitherImage() {
    if (!img || !ditheredImg) return; // Ensure the image is loaded

    ditheredImg.background(255);
    let resolution = parseInt(resInput.value());
    img.loadPixels();

    // Define Perlin noise offsets
    let noiseOffsetX = 0;
    let noiseOffsetY = 200000000; // Start y offset far enough away from x to get independent noise values

    for (let y = 0; y < img.height; y += resolution) {
        for (let x = 0; x < img.width; x += resolution) {
            let gray = 0;
            let count = 0;

            for (let ny = y; ny < y + resolution && ny < img.height; ny++) {
                for (let nx = x; nx < x + resolution && nx < img.width; nx++) {
                    let nindex = (nx + ny * img.width) * 4;
                    gray += (img.pixels[nindex] + img.pixels[nindex + 1] + img.pixels[nindex + 2]) / 3;
                    count++;
                }
            }
            gray /= count;

            // Apply Perlin noise to text position
            let noiseX = noise(noiseOffsetX) * resolution - resolution / 2; // Offset within the block size
            let noiseY = noise(noiseOffsetY) * resolution - resolution / 2;

            // Updating noise offsets
            noiseOffsetX += 10; // Increment offsets to walk through the noise space
            noiseOffsetY += 10;

            // Text attributes
            //ditheredImg.fill(random(255), random(255), random(255)); // Set text color
            ditheredImg.fill(0 + gray); // Set text color
            //ditheredImg.noStroke();
            ditheredImg.stroke(random(255), random(255), random(255));
            ditheredImg.strokeWeight(0.11);
            ditheredImg.textFont('Arial');
            ditheredImg.textSize(gray / 10); // Size based on gray value for variation
            // Draw text with Perlin noise-applied positions
            ditheredImg.rotate(PI / 2);
            ditheredImg.text("FUCK", x + resolution / 2 + noiseX, y + resolution / 2 + noiseY);

        }
    }

    // After applying the dithering effect, display the scaled version on the main canvas
    image(ditheredImg, -width / 2, -height / 2, width, height);
}


function downloadImage() {
    // Save the off-screen buffer, preserving the original image dimensions and dithering effect
    save(ditheredImg, 'dithered_image.png');
}